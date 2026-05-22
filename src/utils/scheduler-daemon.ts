import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  DEFAULT_AUTONOMY_DIR,
  listAllLoops,
  listAllSchedules,
  updateLastRun,
  updateScheduleNextRun,
  type LoopRegistration,
  type ScheduleRegistration,
} from "./autonomy-store.js";

export interface DaemonOptions {
  pollIntervalMs?: number;
  pidFilePath?: string;
  logFilePath?: string;
  autonomyDir?: string;
  spawnFn?: typeof spawn;
  now?: () => number;
  exitSignal?: { stop: boolean };
}

const DEFAULT_POLL_MS = 60_000;
const PROMPT_TRUNCATE = 80;

function consiliumDir(): string {
  return path.join(os.homedir(), ".consilium");
}

export function defaultPidFilePath(): string {
  return path.join(consiliumDir(), "scheduler.pid");
}

export function defaultLogFilePath(): string {
  return path.join(consiliumDir(), "scheduler.log");
}

function ensureParentDir(file: string): void {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function readSchedulerPid(pidFilePath?: string): number | null {
  const file = pidFilePath ?? defaultPidFilePath();
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, "utf-8").trim();
    const pid = Number.parseInt(raw, 10);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    return pid;
  } catch {
    return null;
  }
}

function processAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM") return true;
    return false;
  }
}

export function isSchedulerRunning(pidFilePath?: string): boolean {
  const pid = readSchedulerPid(pidFilePath);
  if (pid === null) return false;
  return processAlive(pid);
}

function truncatePrompt(prompt: string): string {
  if (prompt.length <= PROMPT_TRUNCATE) return prompt;
  return prompt.slice(0, PROMPT_TRUNCATE - 1) + "...";
}

function appendLog(logFilePath: string, line: string): void {
  try {
    ensureParentDir(logFilePath);
    fs.appendFileSync(logFilePath, line + "\n", "utf-8");
  } catch {
    /* best-effort */
  }
}

function resolveConsiliumBinary(): { command: string; prefixArgs: string[] } {
  const override = process.env["CONSILIUM_BIN"];
  if (override && override.length > 0) {
    return { command: override, prefixArgs: [] };
  }
  const argv1 = process.argv[1];
  if (argv1 && fs.existsSync(argv1)) {
    return { command: process.execPath, prefixArgs: [argv1] };
  }
  return { command: "consilium", prefixArgs: [] };
}

function fireDebate(
  prompt: string,
  spawnFn: typeof spawn,
): { ok: true; pid: number | undefined } | { ok: false; error: string } {
  try {
    const { command, prefixArgs } = resolveConsiliumBinary();
    const fullArgs = [...prefixArgs, "debate", prompt, "--bg"];
    const child = spawnFn(command, fullArgs, {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, CONSILIUM_BG_AGENT: "1" },
    });
    const pid = child.pid;
    if (typeof child.unref === "function") child.unref();
    return { ok: true, pid };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function timestamp(now: number): string {
  return new Date(now).toISOString();
}

export function pollOnce(
  opts: {
    autonomyDir?: string;
    logFilePath?: string;
    spawnFn?: typeof spawn;
    now?: () => number;
  } = {},
): { firedLoops: number; firedSchedules: number; skipped: number } {
  const autonomyDir = opts.autonomyDir ?? DEFAULT_AUTONOMY_DIR;
  const logFilePath = opts.logFilePath ?? defaultLogFilePath();
  const spawnFn = opts.spawnFn ?? spawn;
  const nowFn = opts.now ?? Date.now;
  let firedLoops = 0;
  let firedSchedules = 0;
  let skipped = 0;

  let loops: LoopRegistration[] = [];
  let schedules: ScheduleRegistration[] = [];
  try {
    loops = listAllLoops(autonomyDir);
  } catch (err) {
    appendLog(
      logFilePath,
      `[${timestamp(nowFn())}] error listing loops: ${(err as Error).message}`,
    );
  }
  try {
    schedules = listAllSchedules(autonomyDir);
  } catch (err) {
    appendLog(
      logFilePath,
      `[${timestamp(nowFn())}] error listing schedules: ${(err as Error).message}`,
    );
  }

  for (const loop of loops) {
    const last = typeof loop.lastRunAt === "number" ? loop.lastRunAt : 0;
    const due = last + loop.intervalMs <= nowFn();
    if (!due) {
      skipped += 1;
      continue;
    }
    const result = fireDebate(loop.prompt, spawnFn);
    const now = nowFn();
    if (!result.ok) {
      appendLog(
        logFilePath,
        `[${timestamp(now)}] loop ${loop.id} session=${loop.sessionId} spawn-error: ${result.error}`,
      );
      continue;
    }
    try {
      updateLastRun(loop.sessionId, loop.id, now, autonomyDir);
    } catch {
      /* best-effort */
    }
    appendLog(
      logFilePath,
      `[${timestamp(now)}] loop ${loop.id} session=${loop.sessionId} fired prompt="${truncatePrompt(loop.prompt)}"`,
    );
    firedLoops += 1;
  }

  for (const sched of schedules) {
    const due = sched.nextRunAt <= nowFn();
    if (!due) {
      skipped += 1;
      continue;
    }
    const result = fireDebate(sched.prompt, spawnFn);
    const now = nowFn();
    if (!result.ok) {
      appendLog(
        logFilePath,
        `[${timestamp(now)}] schedule ${sched.id} session=${sched.sessionId} spawn-error: ${result.error}`,
      );
      continue;
    }
    try {
      updateScheduleNextRun(
        sched.sessionId,
        sched.id,
        now + sched.intervalMs,
        now,
        autonomyDir,
      );
    } catch {
      /* best-effort */
    }
    appendLog(
      logFilePath,
      `[${timestamp(now)}] schedule ${sched.id} session=${sched.sessionId} spec=${sched.spec} fired prompt="${truncatePrompt(sched.prompt)}"`,
    );
    firedSchedules += 1;
  }

  return { firedLoops, firedSchedules, skipped };
}

function writePidFile(pidFilePath: string): void {
  ensureParentDir(pidFilePath);
  fs.writeFileSync(pidFilePath, String(process.pid), "utf-8");
}

function removePidFile(pidFilePath: string): void {
  try {
    if (fs.existsSync(pidFilePath)) fs.unlinkSync(pidFilePath);
  } catch {
    /* best-effort */
  }
}

export async function runScheduler(opts: DaemonOptions = {}): Promise<void> {
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_MS;
  const pidFilePath = opts.pidFilePath ?? defaultPidFilePath();
  const logFilePath = opts.logFilePath ?? defaultLogFilePath();
  const autonomyDir = opts.autonomyDir ?? DEFAULT_AUTONOMY_DIR;
  const spawnFn = opts.spawnFn ?? spawn;
  const nowFn = opts.now ?? Date.now;

  writePidFile(pidFilePath);
  appendLog(
    logFilePath,
    `[${timestamp(nowFn())}] scheduler started pid=${process.pid} pollMs=${pollIntervalMs}`,
  );

  const externalStop = opts.exitSignal;
  let stopped = false;

  const shutdown = (signal: string): void => {
    if (stopped) return;
    stopped = true;
    appendLog(
      logFilePath,
      `[${timestamp(nowFn())}] scheduler stopping signal=${signal}`,
    );
    removePidFile(pidFilePath);
  };

  const onSigTerm = () => {
    shutdown("SIGTERM");
    process.exit(0);
  };
  const onSigInt = () => {
    shutdown("SIGINT");
    process.exit(0);
  };
  process.on("SIGTERM", onSigTerm);
  process.on("SIGINT", onSigInt);

  try {
    while (!stopped && !(externalStop && externalStop.stop)) {
      pollOnce({ autonomyDir, logFilePath, spawnFn, now: nowFn });
      if (externalStop && externalStop.stop) break;
      await sleep(pollIntervalMs, externalStop);
    }
  } finally {
    if (!stopped) {
      shutdown("exit");
    }
    process.removeListener("SIGTERM", onSigTerm);
    process.removeListener("SIGINT", onSigInt);
  }
}

function sleep(ms: number, externalStop?: { stop: boolean }): Promise<void> {
  return new Promise((resolve) => {
    if (externalStop && externalStop.stop) {
      resolve();
      return;
    }
    const step = Math.min(ms, 250);
    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed += step;
      if (
        elapsed >= ms ||
        (externalStop !== undefined && externalStop.stop === true)
      ) {
        clearInterval(interval);
        resolve();
      }
    }, step);
    if (typeof (interval as { unref?: () => void }).unref === "function") {
      (interval as { unref: () => void }).unref();
    }
  });
}
