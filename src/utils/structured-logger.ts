import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  service: string;
  event: string;
  [key: string]: any;
}

export interface QueryOptions {
  debateId?: string;
  sessionId?: string;
  level?: LogLevel;
  event?: string;
  since?: Date;
  limit?: number;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

export const LOG_DIR = path.join(os.homedir(), ".consilium", "logs");

function logEntryMatchesOptions(
  entry: LogEntry,
  options: QueryOptions,
  minLevel: number,
  sinceStr: string | undefined,
): boolean {
  if (options.debateId && entry.debateId !== options.debateId) return false;
  if (options.sessionId && entry.sessionId !== options.sessionId) return false;
  if (options.event && entry.event !== options.event) return false;
  if (LOG_LEVELS[entry.level] < minLevel) return false;
  if (sinceStr && entry.ts < sinceStr) return false;
  return true;
}

function tryParseLogLine(line: string): LogEntry | null {
  try {
    return JSON.parse(line) as LogEntry;
  } catch {
    return null;
  }
}

export class StructuredLogger {
  private readonly service: string;
  private context: Record<string, any>;

  constructor(service: string = "cli") {
    this.service = service;
    this.context = {};
  }

  debug(event: string, data?: Record<string, any>): void {
    this.log("DEBUG", event, data);
  }

  info(event: string, data?: Record<string, any>): void {
    this.log("INFO", event, data);
  }

  warn(event: string, data?: Record<string, any>): void {
    this.log("WARN", event, data);
  }

  error(event: string, data?: Record<string, any>): void {
    this.log("ERROR", event, data);
  }

  log(level: LogLevel, event: string, data?: Record<string, any>): void {
    this.ensureLogDir();

    const entry: Record<string, any> = {
      ts: new Date().toISOString(),
      level,
      service: this.service,
      ...this.context,
      event,
    };

    if (data) {
      if (data.durationMs !== undefined) entry.durationMs = data.durationMs;
      const rest = { ...data };
      delete rest.durationMs;
      if (Object.keys(rest).length > 0) entry.data = rest;
    }

    this.write(entry);
  }

  withContext(ctx: Record<string, any>): StructuredLogger {
    const child = new StructuredLogger(this.service);
    child.context = { ...this.context, ...ctx };
    return child;
  }

  cleanup(): void {
    if (!fs.existsSync(LOG_DIR)) return;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = formatDate(cutoff);

    const files = fs.readdirSync(LOG_DIR).filter((f) => f.endsWith(".jsonl"));
    for (const file of files) {
      const dateStr = file.replace(".jsonl", "");
      if (dateStr < cutoffStr) {
        fs.unlinkSync(path.join(LOG_DIR, file));
      }
    }
  }

  private getLogFilePath(): string {
    return path.join(LOG_DIR, `${formatDate(new Date())}.jsonl`);
  }

  private ensureLogDir(): void {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  }

  private write(entry: object): void {
    fs.appendFileSync(
      this.getLogFilePath(),
      JSON.stringify(entry) + "\n",
      "utf-8",
    );
  }
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function createLogger(service?: string): StructuredLogger {
  return new StructuredLogger(service);
}

function appendMatchingEntriesFromFile(
  file: string,
  options: QueryOptions,
  minLevel: number,
  sinceStr: string | undefined,
  limit: number,
  results: LogEntry[],
): void {
  const content = fs.readFileSync(path.join(LOG_DIR, file), "utf-8");
  const lines = content
    .split("\n")
    .filter((l) => l.trim())
    .reverse();

  for (const line of lines) {
    if (results.length >= limit) break;

    const entry = tryParseLogLine(line);
    if (!entry) continue;
    if (!logEntryMatchesOptions(entry, options, minLevel, sinceStr)) continue;
    results.push(entry);
  }
}

export function queryLogs(options: QueryOptions): LogEntry[] {
  if (!fs.existsSync(LOG_DIR)) return [];

  const limit = options.limit ?? 100;
  const minLevel = options.level ? LOG_LEVELS[options.level] : 0;
  const sinceStr = options.since ? options.since.toISOString() : undefined;
  const results: LogEntry[] = [];

  const files = fs
    .readdirSync(LOG_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .reverse();

  for (const file of files) {
    if (results.length >= limit) break;
    appendMatchingEntriesFromFile(
      file,
      options,
      minLevel,
      sinceStr,
      limit,
      results,
    );
  }

  return results;
}
