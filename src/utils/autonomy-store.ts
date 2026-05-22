import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_AUTONOMY_DIR = path.join(
  os.homedir(),
  ".consilium",
  "autonomy",
);

export interface LoopRegistration {
  id: string;
  sessionId: string;
  intervalMs: number;
  prompt: string;
  createdAt: number;
  lastRunAt?: number;
}

export interface ScheduleRegistration {
  id: string;
  sessionId: string;
  spec: string;
  intervalMs: number;
  nextRunAt: number;
  prompt: string;
  createdAt: number;
  lastRunAt?: number;
}

export interface GoalRegistration {
  sessionId: string;
  text: string;
  setAt: number;
}

function sessionDir(sessionId: string, baseDir: string): string {
  return path.join(baseDir, sessionId);
}

function ensureSessionDir(sessionId: string, baseDir: string): string {
  const dir = sessionDir(sessionId, baseDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function loopsPath(sessionId: string, baseDir: string): string {
  return path.join(sessionDir(sessionId, baseDir), "loops.json");
}

function schedulesPath(sessionId: string, baseDir: string): string {
  return path.join(sessionDir(sessionId, baseDir), "schedules.json");
}

function goalPath(sessionId: string, baseDir: string): string {
  return path.join(sessionDir(sessionId, baseDir), "goal.json");
}

function atomicWriteJson(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
}

function readJsonArray<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function persistLoop(
  reg: LoopRegistration,
  baseDir: string = DEFAULT_AUTONOMY_DIR,
): void {
  ensureSessionDir(reg.sessionId, baseDir);
  const file = loopsPath(reg.sessionId, baseDir);
  const current = readJsonArray<LoopRegistration>(file).filter(
    (r) => r.id !== reg.id,
  );
  current.push(reg);
  atomicWriteJson(file, current);
}

export function persistSchedule(
  reg: ScheduleRegistration,
  baseDir: string = DEFAULT_AUTONOMY_DIR,
): void {
  ensureSessionDir(reg.sessionId, baseDir);
  const file = schedulesPath(reg.sessionId, baseDir);
  const current = readJsonArray<ScheduleRegistration>(file).filter(
    (r) => r.id !== reg.id,
  );
  current.push(reg);
  atomicWriteJson(file, current);
}

export function persistGoal(
  reg: GoalRegistration,
  baseDir: string = DEFAULT_AUTONOMY_DIR,
): void {
  ensureSessionDir(reg.sessionId, baseDir);
  atomicWriteJson(goalPath(reg.sessionId, baseDir), reg);
}

export function removeLoop(
  sessionId: string,
  id: string,
  baseDir: string = DEFAULT_AUTONOMY_DIR,
): void {
  const file = loopsPath(sessionId, baseDir);
  if (!fs.existsSync(file)) return;
  const remaining = readJsonArray<LoopRegistration>(file).filter(
    (r) => r.id !== id,
  );
  if (remaining.length === 0) {
    fs.unlinkSync(file);
    return;
  }
  atomicWriteJson(file, remaining);
}

export function removeSchedule(
  sessionId: string,
  id: string,
  baseDir: string = DEFAULT_AUTONOMY_DIR,
): void {
  const file = schedulesPath(sessionId, baseDir);
  if (!fs.existsSync(file)) return;
  const remaining = readJsonArray<ScheduleRegistration>(file).filter(
    (r) => r.id !== id,
  );
  if (remaining.length === 0) {
    fs.unlinkSync(file);
    return;
  }
  atomicWriteJson(file, remaining);
}

export function clearGoal(
  sessionId: string,
  baseDir: string = DEFAULT_AUTONOMY_DIR,
): void {
  const file = goalPath(sessionId, baseDir);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
}

export function listLoopsForSession(
  sessionId: string,
  baseDir: string = DEFAULT_AUTONOMY_DIR,
): LoopRegistration[] {
  return readJsonArray<LoopRegistration>(loopsPath(sessionId, baseDir));
}

export function listSchedulesForSession(
  sessionId: string,
  baseDir: string = DEFAULT_AUTONOMY_DIR,
): ScheduleRegistration[] {
  return readJsonArray<ScheduleRegistration>(schedulesPath(sessionId, baseDir));
}

export function getGoalForSession(
  sessionId: string,
  baseDir: string = DEFAULT_AUTONOMY_DIR,
): GoalRegistration | null {
  const file = goalPath(sessionId, baseDir);
  if (!fs.existsSync(file)) return null;
  try {
    const content = fs.readFileSync(file, "utf-8");
    return JSON.parse(content) as GoalRegistration;
  } catch {
    return null;
  }
}

export function updateLoopLastRun(
  sessionId: string,
  id: string,
  lastRunAt: number,
  baseDir: string = DEFAULT_AUTONOMY_DIR,
): void {
  const file = loopsPath(sessionId, baseDir);
  if (!fs.existsSync(file)) return;
  const list = readJsonArray<LoopRegistration>(file);
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return;
  const target = list[idx];
  if (!target) return;
  list[idx] = { ...target, lastRunAt };
  atomicWriteJson(file, list);
}

export function updateScheduleNextRun(
  sessionId: string,
  id: string,
  nextRunAt: number,
  lastRunAt: number,
  baseDir: string = DEFAULT_AUTONOMY_DIR,
): void {
  const file = schedulesPath(sessionId, baseDir);
  if (!fs.existsSync(file)) return;
  const list = readJsonArray<ScheduleRegistration>(file);
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return;
  const target = list[idx];
  if (!target) return;
  list[idx] = { ...target, nextRunAt, lastRunAt };
  atomicWriteJson(file, list);
}

function listSessionIds(baseDir: string): string[] {
  if (!fs.existsSync(baseDir)) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const ids: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) ids.push(entry.name);
  }
  return ids;
}

export function listAllLoops(
  baseDir: string = DEFAULT_AUTONOMY_DIR,
): LoopRegistration[] {
  const out: LoopRegistration[] = [];
  for (const sessionId of listSessionIds(baseDir)) {
    const list = readJsonArray<LoopRegistration>(loopsPath(sessionId, baseDir));
    for (const reg of list) {
      if (
        reg &&
        typeof reg.id === "string" &&
        typeof reg.sessionId === "string" &&
        typeof reg.intervalMs === "number" &&
        typeof reg.prompt === "string" &&
        Number.isFinite(reg.intervalMs) &&
        reg.intervalMs > 0
      ) {
        out.push(reg);
      }
    }
  }
  return out;
}

export function listAllSchedules(
  baseDir: string = DEFAULT_AUTONOMY_DIR,
): ScheduleRegistration[] {
  const out: ScheduleRegistration[] = [];
  for (const sessionId of listSessionIds(baseDir)) {
    const list = readJsonArray<ScheduleRegistration>(
      schedulesPath(sessionId, baseDir),
    );
    for (const reg of list) {
      if (
        reg &&
        typeof reg.id === "string" &&
        typeof reg.sessionId === "string" &&
        typeof reg.intervalMs === "number" &&
        typeof reg.nextRunAt === "number" &&
        typeof reg.prompt === "string" &&
        Number.isFinite(reg.intervalMs) &&
        reg.intervalMs > 0 &&
        Number.isFinite(reg.nextRunAt)
      ) {
        out.push(reg);
      }
    }
  }
  return out;
}

export function updateLastRun(
  sessionId: string,
  id: string,
  ts: number,
  baseDir: string = DEFAULT_AUTONOMY_DIR,
): void {
  const loopFile = loopsPath(sessionId, baseDir);
  if (fs.existsSync(loopFile)) {
    const list = readJsonArray<LoopRegistration>(loopFile);
    const idx = list.findIndex((r) => r.id === id);
    if (idx !== -1) {
      const target = list[idx];
      if (target) {
        list[idx] = { ...target, lastRunAt: ts };
        atomicWriteJson(loopFile, list);
        return;
      }
    }
  }
  const schedFile = schedulesPath(sessionId, baseDir);
  if (fs.existsSync(schedFile)) {
    const list = readJsonArray<ScheduleRegistration>(schedFile);
    const idx = list.findIndex((r) => r.id === id);
    if (idx !== -1) {
      const target = list[idx];
      if (target) {
        list[idx] = { ...target, lastRunAt: ts };
        atomicWriteJson(schedFile, list);
      }
    }
  }
}
