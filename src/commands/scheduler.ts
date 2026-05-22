import fs from "node:fs";
import { spawn } from "node:child_process";
import { style } from "../utils/visual-system.js";
import {
  defaultLogFilePath,
  defaultPidFilePath,
  isSchedulerRunning,
  readSchedulerPid,
} from "../utils/scheduler-daemon.js";
import { listAllLoops, listAllSchedules } from "../utils/autonomy-store.js";
import { tailLogFile } from "../utils/agent-supervisor.js";

const st = style();

function resolveBinary(): { command: string; prefixArgs: string[] } {
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

export async function schedulerStartCommand(): Promise<void> {
  const pidFile = defaultPidFilePath();
  const logFile = defaultLogFilePath();
  if (isSchedulerRunning(pidFile)) {
    const pid = readSchedulerPid(pidFile);
    console.error(
      st.error(
        `Scheduler already running (pid: ${pid ?? "?"}). Run 'consilium scheduler stop' first.`,
      ),
    );
    process.exitCode = 1;
    return;
  }
  try {
    const { command, prefixArgs } = resolveBinary();
    const fullArgs = [...prefixArgs, "scheduler", "__run__"];
    const child = spawn(command, fullArgs, {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, CONSILIUM_SCHEDULER_DAEMON: "1" },
    });
    if (typeof child.unref === "function") child.unref();
    if (child.pid === undefined) {
      console.error(st.error("Failed to spawn scheduler daemon (no pid)."));
      process.exitCode = 1;
      return;
    }
    console.log(
      st.success(`[scheduler] started (pid: ${child.pid}, log: ${logFile})`),
    );
  } catch (err) {
    console.error(
      st.error(`Failed to start scheduler: ${(err as Error).message}`),
    );
    process.exitCode = 1;
  }
}

function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      try {
        process.kill(pid, 0);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ESRCH") {
          resolve(true);
          return;
        }
      }
      if (Date.now() - start >= timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}

export async function schedulerStopCommand(): Promise<void> {
  const pidFile = defaultPidFilePath();
  const pid = readSchedulerPid(pidFile);
  if (pid === null) {
    console.log(st.dim("Scheduler not running (no pid file)."));
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      try {
        if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
      } catch {
        /* best-effort */
      }
      console.log(st.dim(`Scheduler process ${pid} was already gone.`));
      return;
    }
    console.error(
      st.error(`Failed to signal scheduler: ${(err as Error).message}`),
    );
    process.exitCode = 1;
    return;
  }
  const exited = await waitForExit(pid, 5000);
  if (!exited) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* best-effort */
    }
    await waitForExit(pid, 2000);
  }
  try {
    if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
  } catch {
    /* best-effort */
  }
  console.log(st.success(`Stopped scheduler (pid: ${pid}).`));
}

export async function schedulerStatusCommand(): Promise<void> {
  const pidFile = defaultPidFilePath();
  const logFile = defaultLogFilePath();
  const running = isSchedulerRunning(pidFile);
  const pid = readSchedulerPid(pidFile);
  let loopsCount = 0;
  let schedCount = 0;
  try {
    loopsCount = listAllLoops().length;
  } catch {
    /* best-effort */
  }
  try {
    schedCount = listAllSchedules().length;
  } catch {
    /* best-effort */
  }
  if (running) {
    console.log(st.success(`Scheduler: running (pid: ${pid ?? "?"})`));
  } else {
    console.log(st.dim("Scheduler: stopped"));
  }
  console.log(`  log:       ${logFile}`);
  console.log(`  pid file:  ${pidFile}`);
  console.log(`  loops:     ${loopsCount}`);
  console.log(`  schedules: ${schedCount}`);
}

export async function schedulerTailCommand(
  opts: { follow?: boolean } = {},
): Promise<void> {
  const logFile = defaultLogFilePath();
  if (!fs.existsSync(logFile)) {
    console.log(st.dim(`(no scheduler log yet at ${logFile})`));
    if (!opts.follow) return;
  }
  if (opts.follow) {
    await tailLogFile(logFile, () => false);
    return;
  }
  const data = fs.readFileSync(logFile, "utf-8");
  process.stdout.write(data);
}

export async function schedulerRunDaemonCommand(): Promise<void> {
  const { runScheduler } = await import("../utils/scheduler-daemon.js");
  await runScheduler();
}
