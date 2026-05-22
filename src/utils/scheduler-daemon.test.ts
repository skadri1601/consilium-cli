import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultLogFilePath,
  defaultPidFilePath,
  isSchedulerRunning,
  pollOnce,
  readSchedulerPid,
  runScheduler,
} from "./scheduler-daemon";
import {
  listLoopsForSession,
  listSchedulesForSession,
  persistLoop,
  persistSchedule,
} from "./autonomy-store";

let tmpDir: string;
let logFile: string;
let pidFile: string;

function makeChild(pid: number) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    unref: () => void;
  };
  child.pid = pid;
  child.unref = vi.fn();
  return child;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "consilium-sched-"));
  logFile = path.join(tmpDir, "scheduler.log");
  pidFile = path.join(tmpDir, "scheduler.pid");
});

afterEach(() => {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("readSchedulerPid / isSchedulerRunning", () => {
  it("returns null when pid file does not exist", () => {
    expect(readSchedulerPid(pidFile)).toBeNull();
    expect(isSchedulerRunning(pidFile)).toBe(false);
  });

  it("reads a pid back from the file", () => {
    fs.writeFileSync(pidFile, "12345\n");
    expect(readSchedulerPid(pidFile)).toBe(12345);
  });

  it("returns null on malformed pid file", () => {
    fs.writeFileSync(pidFile, "not-a-number");
    expect(readSchedulerPid(pidFile)).toBeNull();
  });

  it("isSchedulerRunning returns true for the current process pid", () => {
    fs.writeFileSync(pidFile, String(process.pid));
    expect(isSchedulerRunning(pidFile)).toBe(true);
  });

  it("isSchedulerRunning returns false for a clearly dead pid", () => {
    fs.writeFileSync(pidFile, "999999999");
    expect(isSchedulerRunning(pidFile)).toBe(false);
  });
});

describe("defaultPidFilePath / defaultLogFilePath", () => {
  it("default paths live under ~/.consilium/", () => {
    const expectedRoot = path.join(os.homedir(), ".consilium");
    expect(defaultPidFilePath().startsWith(expectedRoot)).toBe(true);
    expect(defaultLogFilePath().startsWith(expectedRoot)).toBe(true);
  });
});

describe("pollOnce - loops", () => {
  it("fires a loop when interval has elapsed and updates lastRunAt", () => {
    const now = 1_700_000_500_000;
    persistLoop(
      {
        id: "loop_due",
        sessionId: "ses_a",
        intervalMs: 60_000,
        prompt: "do the thing",
        createdAt: now - 200_000,
        lastRunAt: now - 120_000,
      },
      tmpDir,
    );
    const spawnFn = vi.fn().mockReturnValue(makeChild(101));
    const result = pollOnce({
      autonomyDir: tmpDir,
      logFilePath: logFile,
      spawnFn: spawnFn as unknown as typeof import("node:child_process").spawn,
      now: () => now,
    });
    expect(result.firedLoops).toBe(1);
    expect(spawnFn).toHaveBeenCalledTimes(1);
    const args = spawnFn.mock.calls[0]![1] as string[];
    expect(args).toContain("debate");
    expect(args).toContain("do the thing");
    expect(args).toContain("--bg");
    const loaded = listLoopsForSession("ses_a", tmpDir);
    expect(loaded[0]?.lastRunAt).toBe(now);
    const logContent = fs.readFileSync(logFile, "utf-8");
    expect(logContent).toContain("loop loop_due");
    expect(logContent).toContain("do the thing");
  });

  it("does not fire when interval has not elapsed", () => {
    const now = 1_700_000_500_000;
    persistLoop(
      {
        id: "loop_pending",
        sessionId: "ses_a",
        intervalMs: 60_000,
        prompt: "wait",
        createdAt: now - 30_000,
        lastRunAt: now - 30_000,
      },
      tmpDir,
    );
    const spawnFn = vi.fn();
    const result = pollOnce({
      autonomyDir: tmpDir,
      logFilePath: logFile,
      spawnFn: spawnFn as unknown as typeof import("node:child_process").spawn,
      now: () => now,
    });
    expect(result.firedLoops).toBe(0);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("fires a loop with no lastRunAt (treats as never-run)", () => {
    const now = 1_700_000_500_000;
    persistLoop(
      {
        id: "loop_fresh",
        sessionId: "ses_a",
        intervalMs: 60_000,
        prompt: "first run",
        createdAt: now - 100,
      },
      tmpDir,
    );
    const spawnFn = vi.fn().mockReturnValue(makeChild(111));
    const result = pollOnce({
      autonomyDir: tmpDir,
      logFilePath: logFile,
      spawnFn: spawnFn as unknown as typeof import("node:child_process").spawn,
      now: () => now,
    });
    expect(result.firedLoops).toBe(1);
  });
});

describe("pollOnce - schedules", () => {
  it("fires a schedule when nextRunAt has elapsed and bumps nextRunAt", () => {
    const now = 1_700_000_500_000;
    persistSchedule(
      {
        id: "sched_due",
        sessionId: "ses_a",
        spec: "5m",
        intervalMs: 300_000,
        nextRunAt: now - 1_000,
        prompt: "digest",
        createdAt: now - 600_000,
      },
      tmpDir,
    );
    const spawnFn = vi.fn().mockReturnValue(makeChild(202));
    const result = pollOnce({
      autonomyDir: tmpDir,
      logFilePath: logFile,
      spawnFn: spawnFn as unknown as typeof import("node:child_process").spawn,
      now: () => now,
    });
    expect(result.firedSchedules).toBe(1);
    const loaded = listSchedulesForSession("ses_a", tmpDir);
    expect(loaded[0]?.nextRunAt).toBe(now + 300_000);
    expect(loaded[0]?.lastRunAt).toBe(now);
    const logContent = fs.readFileSync(logFile, "utf-8");
    expect(logContent).toContain("schedule sched_due");
    expect(logContent).toContain("spec=5m");
  });

  it("does not fire a future schedule", () => {
    const now = 1_700_000_500_000;
    persistSchedule(
      {
        id: "sched_future",
        sessionId: "ses_a",
        spec: "1h",
        intervalMs: 3_600_000,
        nextRunAt: now + 60_000,
        prompt: "later",
        createdAt: now,
      },
      tmpDir,
    );
    const spawnFn = vi.fn();
    const result = pollOnce({
      autonomyDir: tmpDir,
      logFilePath: logFile,
      spawnFn: spawnFn as unknown as typeof import("node:child_process").spawn,
      now: () => now,
    });
    expect(result.firedSchedules).toBe(0);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("handles a daily schedule (24h)", () => {
    const now = 1_700_000_500_000;
    const dayMs = 24 * 60 * 60 * 1000;
    persistSchedule(
      {
        id: "sched_daily",
        sessionId: "ses_a",
        spec: "daily",
        intervalMs: dayMs,
        nextRunAt: now - 1,
        prompt: "morning digest",
        createdAt: now - dayMs,
      },
      tmpDir,
    );
    const spawnFn = vi.fn().mockReturnValue(makeChild(303));
    pollOnce({
      autonomyDir: tmpDir,
      logFilePath: logFile,
      spawnFn: spawnFn as unknown as typeof import("node:child_process").spawn,
      now: () => now,
    });
    const loaded = listSchedulesForSession("ses_a", tmpDir);
    expect(loaded[0]?.nextRunAt).toBe(now + dayMs);
  });
});

describe("pollOnce - malformed entries", () => {
  it("skips entries with invalid intervalMs or missing prompt", () => {
    const sessionDir = path.join(tmpDir, "ses_bad");
    fs.mkdirSync(sessionDir, { recursive: true });
    const loops = [
      {
        id: "ok",
        sessionId: "ses_bad",
        intervalMs: 1000,
        prompt: "valid",
        createdAt: 1,
      },
      {
        id: "bad_no_interval",
        sessionId: "ses_bad",
        prompt: "no interval",
        createdAt: 1,
      },
      {
        id: "bad_no_prompt",
        sessionId: "ses_bad",
        intervalMs: 1000,
        createdAt: 1,
      },
      {
        id: "bad_negative",
        sessionId: "ses_bad",
        intervalMs: -100,
        prompt: "neg",
        createdAt: 1,
      },
    ];
    fs.writeFileSync(
      path.join(sessionDir, "loops.json"),
      JSON.stringify(loops),
    );
    const spawnFn = vi.fn().mockReturnValue(makeChild(404));
    const now = 1_700_000_999_999;
    const result = pollOnce({
      autonomyDir: tmpDir,
      logFilePath: logFile,
      spawnFn: spawnFn as unknown as typeof import("node:child_process").spawn,
      now: () => now,
    });
    expect(result.firedLoops).toBe(1);
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it("survives totally corrupt json files", () => {
    const sessionDir = path.join(tmpDir, "ses_corrupt");
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, "loops.json"), "{not json");
    fs.writeFileSync(path.join(sessionDir, "schedules.json"), "<<not json");
    const spawnFn = vi.fn();
    expect(() =>
      pollOnce({
        autonomyDir: tmpDir,
        logFilePath: logFile,
        spawnFn:
          spawnFn as unknown as typeof import("node:child_process").spawn,
        now: () => 0,
      }),
    ).not.toThrow();
    expect(spawnFn).not.toHaveBeenCalled();
  });
});

describe("pollOnce - prompt truncation in log", () => {
  it("truncates long prompts in the log line", () => {
    const longPrompt = "x".repeat(500);
    const now = 1_700_000_000_000;
    persistLoop(
      {
        id: "loop_long",
        sessionId: "ses_a",
        intervalMs: 1000,
        prompt: longPrompt,
        createdAt: 1,
      },
      tmpDir,
    );
    const spawnFn = vi.fn().mockReturnValue(makeChild(505));
    pollOnce({
      autonomyDir: tmpDir,
      logFilePath: logFile,
      spawnFn: spawnFn as unknown as typeof import("node:child_process").spawn,
      now: () => now,
    });
    const logContent = fs.readFileSync(logFile, "utf-8");
    expect(logContent).toContain("...");
    expect(logContent.length).toBeLessThan(longPrompt.length + 200);
  });
});

describe("pollOnce - spawn failures", () => {
  it("logs an error and leaves lastRunAt untouched when spawn throws", () => {
    const now = 1_700_000_500_000;
    persistLoop(
      {
        id: "loop_err",
        sessionId: "ses_a",
        intervalMs: 100,
        prompt: "boom",
        createdAt: 1,
        lastRunAt: 200,
      },
      tmpDir,
    );
    const spawnFn = vi.fn().mockImplementation(() => {
      throw new Error("spawn-fail");
    });
    pollOnce({
      autonomyDir: tmpDir,
      logFilePath: logFile,
      spawnFn: spawnFn as unknown as typeof import("node:child_process").spawn,
      now: () => now,
    });
    const loaded = listLoopsForSession("ses_a", tmpDir);
    expect(loaded[0]?.lastRunAt).toBe(200);
    const logContent = fs.readFileSync(logFile, "utf-8");
    expect(logContent).toContain("spawn-error");
  });
});

describe("runScheduler", () => {
  it("writes a pid file, polls at least once, then exits cleanly when stop is signaled", async () => {
    const now = 1_700_000_000_000;
    persistLoop(
      {
        id: "loop_run",
        sessionId: "ses_a",
        intervalMs: 100,
        prompt: "ping",
        createdAt: 1,
      },
      tmpDir,
    );
    const spawnFn = vi.fn().mockReturnValue(makeChild(909));
    const externalStop = { stop: false };
    const runPromise = runScheduler({
      pollIntervalMs: 50,
      pidFilePath: pidFile,
      logFilePath: logFile,
      autonomyDir: tmpDir,
      spawnFn: spawnFn as unknown as typeof import("node:child_process").spawn,
      now: () => now,
      exitSignal: externalStop,
    });

    await new Promise((r) => setTimeout(r, 150));
    expect(fs.existsSync(pidFile)).toBe(true);
    expect(fs.readFileSync(pidFile, "utf-8")).toBe(String(process.pid));
    externalStop.stop = true;
    await runPromise;
    expect(fs.existsSync(pidFile)).toBe(false);
    expect(spawnFn).toHaveBeenCalled();
    const logContent = fs.readFileSync(logFile, "utf-8");
    expect(logContent).toContain("scheduler started");
    expect(logContent).toContain("scheduler stopping");
  });
});
