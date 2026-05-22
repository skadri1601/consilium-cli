import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import {
  AgentRecord,
  createAgent,
  ensureRegistryDir,
  getAgent,
  getAgentsDir,
  getLogPath,
  removeAgent,
  sanitizeArgs,
  updateAgentStatus,
} from "./agent-registry.js";

export interface SpawnOptions {
  command: string;
  args: string[];
  cwd?: string;
}

function isAlive(pid: number): boolean {
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

export async function spawnDetached(opts: SpawnOptions): Promise<AgentRecord> {
  const id = crypto.randomUUID();
  ensureRegistryDir();
  const logPath = getLogPath(id);
  const cleanedArgs = sanitizeArgs(opts.args);
  const cwd = opts.cwd ?? process.cwd();

  const fd = fs.openSync(logPath, "a");
  try {
    const { command, prefixArgs } = resolveConsiliumBinary();
    const fullArgs = [...prefixArgs, opts.command, ...cleanedArgs];
    const child = spawn(command, fullArgs, {
      detached: true,
      stdio: ["ignore", fd, fd],
      cwd,
      env: { ...process.env, CONSILIUM_BG_AGENT: "1" },
    });
    const pid = child.pid;
    if (pid === undefined) {
      throw new Error("Failed to spawn detached process (no pid)");
    }
    child.unref();
    const record = createAgent({
      id,
      command: opts.command,
      args: cleanedArgs,
      pid,
      status: "running",
      logPath,
      cwd,
    });
    return record;
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* best-effort */
    }
  }
}

export async function attachToAgent(id: string): Promise<void> {
  const record = getAgent(id);
  if (!record) throw new Error(`Agent not found: ${id}`);
  await tailLogFile(record.logPath, () => !isAlive(record.pid));
}

export async function stopAgent(
  id: string,
  opts: { signal?: NodeJS.Signals; timeoutMs?: number } = {},
): Promise<void> {
  const record = getAgent(id);
  if (!record) throw new Error(`Agent not found: ${id}`);
  if (record.status !== "running") return;
  const signal = opts.signal ?? "SIGTERM";
  const timeoutMs = opts.timeoutMs ?? 5000;
  try {
    process.kill(record.pid, signal);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      updateAgentStatus(id, { status: "exited", exitedAt: Date.now() });
      return;
    }
    throw err;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(record.pid)) {
      updateAgentStatus(id, { status: "killed", exitedAt: Date.now() });
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (isAlive(record.pid)) {
    try {
      process.kill(record.pid, "SIGKILL");
    } catch {
      /* best-effort */
    }
  }
  updateAgentStatus(id, { status: "killed", exitedAt: Date.now() });
}

export async function respawnAgent(id: string): Promise<AgentRecord> {
  const record = getAgent(id);
  if (!record) throw new Error(`Agent not found: ${id}`);
  return spawnDetached({
    command: record.command,
    args: record.args,
    cwd: record.cwd,
  });
}

export interface TailOptions {
  follow?: boolean;
  out?: NodeJS.WritableStream;
}

export async function readLogOnce(
  id: string,
  out: NodeJS.WritableStream = process.stdout,
): Promise<void> {
  const record = getAgent(id);
  if (!record) throw new Error(`Agent not found: ${id}`);
  if (!fs.existsSync(record.logPath)) return;
  const data = fs.readFileSync(record.logPath, "utf-8");
  out.write(data);
}

export async function tailLogFile(
  logPath: string,
  isDone: () => boolean,
  out: NodeJS.WritableStream = process.stdout,
  pollMs: number = 250,
): Promise<void> {
  if (!fs.existsSync(logPath)) {
    fs.writeFileSync(logPath, "");
  }
  let offset = 0;
  const flushFrom = (): boolean => {
    try {
      const stat = fs.statSync(logPath);
      if (stat.size <= offset) return false;
      const fd = fs.openSync(logPath, "r");
      try {
        const len = stat.size - offset;
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, offset);
        out.write(buf.toString("utf-8"));
        offset = stat.size;
        return true;
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return false;
    }
  };
  flushFrom();
  return new Promise<void>((resolve) => {
    let stopped = false;
    const onInt = () => {
      stopped = true;
    };
    process.once("SIGINT", onInt);
    const interval = setInterval(() => {
      flushFrom();
      if (stopped || isDone()) {
        flushFrom();
        clearInterval(interval);
        process.removeListener("SIGINT", onInt);
        resolve();
      }
    }, pollMs);
  });
}

export function purgeExitedAgent(id: string): void {
  const record = getAgent(id);
  if (!record) return;
  if (record.status === "running") {
    throw new Error(`Cannot remove running agent ${id}; stop it first.`);
  }
  removeAgent(id);
}

export function agentsDir(): string {
  return getAgentsDir();
}

export function pathForLog(id: string): string {
  return path.join(getAgentsDir(), `${id}.log`);
}
