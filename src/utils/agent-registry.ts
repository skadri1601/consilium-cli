import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface AgentRecord {
  id: string;
  command: string;
  args: string[];
  pid: number;
  startedAt: number;
  status: "running" | "exited" | "killed";
  exitCode?: number;
  exitedAt?: number;
  logPath: string;
  cwd: string;
}

const SENSITIVE_FLAGS = new Set([
  "--token",
  "--api-key",
  "--apiKey",
  "--key",
  "--auth",
  "--authorization",
  "--password",
]);

function getRegistryDir(): string {
  const override = process.env["CONSILIUM_AGENTS_DIR"];
  if (override && override.length > 0) return override;
  return path.join(os.homedir(), ".consilium", "agents");
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function recordPath(id: string): string {
  return path.join(getRegistryDir(), `${id}.json`);
}

export function getAgentsDir(): string {
  return getRegistryDir();
}

export function ensureRegistryDir(): string {
  const dir = getRegistryDir();
  ensureDir(dir);
  return dir;
}

export function getLogPath(id: string): string {
  return path.join(getRegistryDir(), `${id}.log`);
}

export function sanitizeArgs(args: string[]): string[] {
  const out: string[] = [];
  let skipNext = false;
  for (const arg of args) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (arg === "--bg" || arg === "-b") continue;
    const eqIdx = arg.indexOf("=");
    const flagPart = eqIdx === -1 ? arg : arg.slice(0, eqIdx);
    if (SENSITIVE_FLAGS.has(flagPart)) {
      if (eqIdx === -1) skipNext = true;
      continue;
    }
    out.push(arg);
  }
  return out;
}

function writeRecord(record: AgentRecord): void {
  const dir = getRegistryDir();
  ensureDir(dir);
  fs.writeFileSync(recordPath(record.id), JSON.stringify(record, null, 2));
}

export function createAgent(
  record: Omit<AgentRecord, "startedAt">,
): AgentRecord {
  const full: AgentRecord = { ...record, startedAt: Date.now() };
  writeRecord(full);
  return full;
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

function reconcileStatus(record: AgentRecord): AgentRecord {
  if (record.status !== "running") return record;
  if (isAlive(record.pid)) return record;
  const updated: AgentRecord = {
    ...record,
    status: "exited",
    exitedAt: record.exitedAt ?? Date.now(),
  };
  try {
    writeRecord(updated);
  } catch {
    /* best-effort */
  }
  return updated;
}

export function listAgents(): AgentRecord[] {
  const dir = getRegistryDir();
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir);
  const records: AgentRecord[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const full = path.join(dir, name);
    try {
      const raw = fs.readFileSync(full, "utf-8");
      const parsed = JSON.parse(raw) as AgentRecord;
      if (parsed && typeof parsed.id === "string") {
        records.push(reconcileStatus(parsed));
      }
    } catch {
      /* skip corrupt files */
    }
  }
  records.sort((a, b) => b.startedAt - a.startedAt);
  return records;
}

export function getAgent(id: string): AgentRecord | null {
  const file = recordPath(id);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw) as AgentRecord;
    if (!parsed || typeof parsed.id !== "string") return null;
    return reconcileStatus(parsed);
  } catch {
    return null;
  }
}

export function updateAgentStatus(
  id: string,
  patch: Partial<AgentRecord>,
): void {
  const existing = getAgent(id);
  if (!existing) return;
  const next: AgentRecord = { ...existing, ...patch, id: existing.id };
  writeRecord(next);
}

export function removeAgent(id: string): void {
  const file = recordPath(id);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  const log = getLogPath(id);
  if (fs.existsSync(log)) {
    try {
      fs.unlinkSync(log);
    } catch {
      /* best-effort */
    }
  }
}
