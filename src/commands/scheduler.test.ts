import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSpawn, mockTailLogFile, mockRunScheduler } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockTailLogFile: vi.fn(),
  mockRunScheduler: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return { ...actual, spawn: mockSpawn };
});

vi.mock("../utils/agent-supervisor", () => ({
  tailLogFile: mockTailLogFile,
}));

vi.mock("../utils/scheduler-daemon", async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import("../utils/scheduler-daemon");
  return { ...actual, runScheduler: mockRunScheduler };
});

vi.mock("../utils/visual-system", () => ({
  style: () => ({
    brand: (s: string) => s,
    dim: (s: string) => s,
    bold: (s: string) => s,
    success: (s: string) => s,
    error: (s: string) => s,
    warning: (s: string) => s,
  }),
}));

import {
  schedulerRunDaemonCommand,
  schedulerStartCommand,
  schedulerStatusCommand,
  schedulerStopCommand,
  schedulerTailCommand,
} from "./scheduler";
import {
  defaultLogFilePath,
  defaultPidFilePath,
} from "../utils/scheduler-daemon";

let tmpDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
let killSpy: ReturnType<typeof vi.spyOn>;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let homeSpy: ReturnType<typeof vi.spyOn>;

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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "consilium-scheduler-cmd-"));
  homeSpy = vi.spyOn(os, "homedir").mockReturnValue(tmpDir);
  process.exitCode = 0;
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  mockSpawn.mockReset();
  mockTailLogFile.mockReset();
  mockRunScheduler.mockReset();
});

afterEach(() => {
  process.exitCode = 0;
  logSpy.mockRestore();
  errSpy.mockRestore();
  killSpy.mockRestore();
  stdoutSpy.mockRestore();
  homeSpy.mockRestore();
  if (fs.existsSync(tmpDir))
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("schedulerStartCommand", () => {
  it("spawns the daemon and prints the pid + log path", async () => {
    mockSpawn.mockReturnValue(makeChild(31415));
    await schedulerStartCommand();
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const spawnArgs = mockSpawn.mock.calls[0]![1] as string[];
    expect(spawnArgs).toContain("scheduler");
    expect(spawnArgs).toContain("__run__");
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("[scheduler] started");
    expect(out).toContain("31415");
    expect(out).toContain(defaultLogFilePath());
  });

  it("refuses to start when already running", async () => {
    fs.mkdirSync(path.dirname(defaultPidFilePath()), { recursive: true });
    fs.writeFileSync(defaultPidFilePath(), String(process.pid));
    await schedulerStartCommand();
    expect(process.exitCode).toBe(1);
    expect(mockSpawn).not.toHaveBeenCalled();
    const err = errSpy.mock.calls.flat().join("\n");
    expect(err).toContain("already running");
  });

  it("errors when spawn returns no pid", async () => {
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = vi.fn();
    mockSpawn.mockReturnValue(child);
    await schedulerStartCommand();
    expect(process.exitCode).toBe(1);
  });
});

describe("schedulerStopCommand", () => {
  it("no-ops when no pid file exists", async () => {
    await schedulerStopCommand();
    expect(killSpy).not.toHaveBeenCalled();
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("not running");
  });

  it("signals SIGTERM and removes the pid file", async () => {
    const pidFile = defaultPidFilePath();
    fs.mkdirSync(path.dirname(pidFile), { recursive: true });
    fs.writeFileSync(pidFile, "12345");
    let aliveCheckCount = 0;
    killSpy.mockImplementation(
      (_pid: number, signal?: number | NodeJS.Signals) => {
        if (signal === "SIGTERM") return true;
        if (signal === 0) {
          aliveCheckCount += 1;
          if (aliveCheckCount > 1) {
            const err = new Error("ESRCH") as NodeJS.ErrnoException;
            err.code = "ESRCH";
            throw err;
          }
          return true;
        }
        return true;
      },
    );
    await schedulerStopCommand();
    const sigtermCalls = (killSpy.mock.calls as unknown[][]).filter(
      (c) => c[1] === "SIGTERM",
    );
    expect(sigtermCalls.length).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(pidFile)).toBe(false);
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("Stopped scheduler");
  });

  it("cleans up pid file when process is already gone (ESRCH)", async () => {
    const pidFile = defaultPidFilePath();
    fs.mkdirSync(path.dirname(pidFile), { recursive: true });
    fs.writeFileSync(pidFile, "99999");
    killSpy.mockImplementation(() => {
      const err = new Error("ESRCH") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    });
    await schedulerStopCommand();
    expect(fs.existsSync(pidFile)).toBe(false);
  });
});

describe("schedulerStatusCommand", () => {
  it("reports stopped when no pid file present", async () => {
    await schedulerStatusCommand();
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("Scheduler: stopped");
    expect(out).toContain("loops:");
    expect(out).toContain("schedules:");
  });

  it("reports running when pid file points at current process", async () => {
    const pidFile = defaultPidFilePath();
    fs.mkdirSync(path.dirname(pidFile), { recursive: true });
    fs.writeFileSync(pidFile, String(process.pid));
    await schedulerStatusCommand();
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("Scheduler: running");
    expect(out).toContain(String(process.pid));
  });
});

describe("schedulerTailCommand", () => {
  it("prints the log content when log file exists", async () => {
    const logFile = defaultLogFilePath();
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, "hello scheduler\n");
    await schedulerTailCommand({ follow: false });
    const writes = (stdoutSpy.mock.calls as unknown[][])
      .map((c) =>
        typeof c[0] === "string"
          ? c[0]
          : Buffer.from(c[0] as Uint8Array).toString("utf-8"),
      )
      .join("");
    expect(writes).toContain("hello scheduler");
    expect(mockTailLogFile).not.toHaveBeenCalled();
  });

  it("invokes tailLogFile with --follow", async () => {
    const logFile = defaultLogFilePath();
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, "line\n");
    mockTailLogFile.mockResolvedValue(undefined);
    await schedulerTailCommand({ follow: true });
    expect(mockTailLogFile).toHaveBeenCalled();
  });

  it("prints empty-state message when no log exists", async () => {
    await schedulerTailCommand({ follow: false });
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("no scheduler log yet");
  });
});

describe("schedulerRunDaemonCommand", () => {
  it("invokes runScheduler", async () => {
    mockRunScheduler.mockResolvedValue(undefined);
    await schedulerRunDaemonCommand();
    expect(mockRunScheduler).toHaveBeenCalledTimes(1);
  });
});
