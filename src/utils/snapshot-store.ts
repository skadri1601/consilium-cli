import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ChatSessionData } from "../commands/chat-session";

export const DEFAULT_SESSION_DIR = path.join(
  os.homedir(),
  ".consilium",
  "sessions",
);

export interface SessionSnapshot {
  id: string;
  sessionId: string;
  label: string;
  createdAt: number;
  debateCount: number;
  payload: ChatSessionData;
}

export function getSnapshotDir(
  sessionId: string,
  baseDir: string = DEFAULT_SESSION_DIR,
): string {
  return path.join(baseDir, sessionId, "snapshots");
}

export function ensureSnapshotDir(
  sessionId: string,
  baseDir: string = DEFAULT_SESSION_DIR,
): string {
  const dir = getSnapshotDir(sessionId, baseDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getSnapshotPath(
  sessionId: string,
  snapshotId: string,
  baseDir: string = DEFAULT_SESSION_DIR,
): string {
  return path.join(getSnapshotDir(sessionId, baseDir), `${snapshotId}.json`);
}

export function writeSnapshot(
  snapshot: SessionSnapshot,
  baseDir: string = DEFAULT_SESSION_DIR,
): string {
  const dir = ensureSnapshotDir(snapshot.sessionId, baseDir);
  const filePath = path.join(dir, `${snapshot.id}.json`);
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
  return filePath;
}

export function readSnapshot(
  sessionId: string,
  snapshotId: string,
  baseDir: string = DEFAULT_SESSION_DIR,
): SessionSnapshot | null {
  const filePath = getSnapshotPath(sessionId, snapshotId, baseDir);
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as SessionSnapshot;
  } catch {
    return null;
  }
}

export function listSnapshotFiles(
  sessionId: string,
  baseDir: string = DEFAULT_SESSION_DIR,
): SessionSnapshot[] {
  const dir = getSnapshotDir(sessionId, baseDir);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const snapshots: SessionSnapshot[] = [];
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(dir, file), "utf-8");
      snapshots.push(JSON.parse(content) as SessionSnapshot);
    } catch {
      // ignore corrupt files
    }
  }
  snapshots.sort((a, b) => b.createdAt - a.createdAt);
  return snapshots;
}

export function deleteSnapshotFile(
  sessionId: string,
  snapshotId: string,
  baseDir: string = DEFAULT_SESSION_DIR,
): boolean {
  const filePath = getSnapshotPath(sessionId, snapshotId, baseDir);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

export function formatAutoLabel(now: Date = new Date()): string {
  const pad = (n: number): string => n.toString().padStart(2, "0");
  const yyyy = now.getFullYear().toString();
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const mi = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  return `auto-${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}
