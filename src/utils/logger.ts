import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { generateId } from "./id";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export interface LogEntry {
  id: string;
  ts: string;
  level: LogLevel;
  event: string;
  debateId?: string;
  sessionId?: string;
  durationMs?: number;
  tokens?: number;
  cost?: number;
  error?: string;
  data?: Record<string, unknown>;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const LOGS_DIR = path.join(os.homedir(), ".consilium", "logs");
const MAX_LOG_DAYS = 7;

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getLogFilePath(date?: Date): string {
  return path.join(LOGS_DIR, `${formatDate(date || new Date())}.jsonl`);
}

function ensureLogDir(): void {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

function rotateOldLogs(): void {
  if (!fs.existsSync(LOGS_DIR)) return;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_LOG_DAYS);
  const cutoffStr = formatDate(cutoff);

  const files = fs.readdirSync(LOGS_DIR).filter((f) => f.endsWith(".jsonl"));
  for (const file of files) {
    const dateStr = file.replace(".jsonl", "");
    if (dateStr < cutoffStr) {
      fs.unlinkSync(path.join(LOGS_DIR, file));
    }
  }
}

export function log(
  level: LogLevel,
  event: string,
  fields?: Partial<Omit<LogEntry, "id" | "ts" | "level" | "event">>,
): void {
  ensureLogDir();
  rotateOldLogs();

  const entry: LogEntry = {
    id: generateId("log-entry"),
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  };

  fs.appendFileSync(getLogFilePath(), JSON.stringify(entry) + "\n", "utf-8");
}

export function readLogs(debateId?: string, level?: LogLevel): LogEntry[] {
  if (!fs.existsSync(LOGS_DIR)) return [];

  const files = fs
    .readdirSync(LOGS_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .sort();
  const minLevel = level ? LOG_LEVELS[level] : 0;
  const entries: LogEntry[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(LOGS_DIR, file), "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    for (const line of lines) {
      try {
        const entry: LogEntry = JSON.parse(line);
        if (debateId && entry.debateId !== debateId) continue;
        if (LOG_LEVELS[entry.level] < minLevel) continue;
        entries.push(entry);
      } catch {
        continue;
      }
    }
  }

  return entries;
}
