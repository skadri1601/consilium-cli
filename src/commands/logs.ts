import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ConsiliumClient } from "../api/client";
import { requireAuth } from "../utils/require-auth";
import {
  style,
  border,
  borderBottom,
  contentLine,
} from "../utils/visual-system";

const st = style();
const LOGS_DIR = path.join(os.homedir(), ".consilium", "logs");

export interface LogEntry {
  timestamp: string;
  level: "DEBUG" | "INFO" | "WARN" | "ERROR";
  debateId?: string;
  message: string;
  data?: any;
}

const LEVEL_PRIORITY: Record<string, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

function colorForLevel(level: string): (s: string) => string {
  switch (level) {
    case "ERROR":
      return st.error;
    case "WARN":
      return st.warning;
    case "DEBUG":
      return st.dim;
    default:
      return (s: string) => s;
  }
}

function todayFileName(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}.jsonl`;
}

export function appendLog(entry: LogEntry): void {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
  const filePath = path.join(LOGS_DIR, todayFileName());
  fs.appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf-8");
}

function readLocalLogs(debateId: string, level?: string): LogEntry[] {
  if (!fs.existsSync(LOGS_DIR)) return [];

  const files = fs
    .readdirSync(LOGS_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .sort();
  const entries: LogEntry[] = [];

  for (const file of files) {
    const filePath = path.join(LOGS_DIR, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    for (const line of lines) {
      try {
        const entry: LogEntry = JSON.parse(line);
        if (entry.debateId !== debateId) continue;
        if (level && entry.level !== level.toUpperCase()) continue;
        entries.push(entry);
      } catch {}
    }
  }

  return entries;
}

function formatTimestamp(ts: string | undefined): string {
  if (!ts) return "N/A";
  // new Date('') silently returns Invalid Date which then renders
  // toLocaleString() as the literal string "Invalid Date". Guard
  // against malformed timestamps from the API and show 'N/A' instead
  // so the timeline output stays readable.
  const parsed = new Date(ts);
  if (Number.isNaN(parsed.getTime())) return "N/A";
  return parsed.toLocaleString();
}

function buildTimeline(debate: any): LogEntry[] {
  const timeline: LogEntry[] = [];

  if (debate.createdAt) {
    timeline.push({
      timestamp: debate.createdAt,
      level: "INFO",
      debateId: debate.id,
      message: `Debate created: ${debate.topic || "N/A"}`,
    });
  }

  if (
    debate.status === "processing" ||
    debate.status === "completed" ||
    debate.status === "failed"
  ) {
    timeline.push({
      timestamp: debate.updatedAt || debate.createdAt || "",
      level: "INFO",
      debateId: debate.id,
      message: `Status: ${debate.status}`,
    });
  }

  if (debate.status === "completed") {
    timeline.push({
      timestamp: debate.updatedAt || "",
      level: "INFO",
      debateId: debate.id,
      message: "Debate completed successfully",
    });
  }

  if (debate.status === "failed") {
    timeline.push({
      timestamp: debate.updatedAt || "",
      level: "ERROR",
      debateId: debate.id,
      message: `Debate failed: ${debate.error || "Unknown error"}`,
    });
  }

  return timeline;
}

export async function logsCommand(
  debateId: string,
  options: { level?: string },
): Promise<void> {
  let entries = readLocalLogs(debateId, options.level);

  if (entries.length === 0) {
    await requireAuth();
    const client = new ConsiliumClient();

    try {
      const debate = await client.getDebateDetails(debateId);
      const timeline = buildTimeline(debate);
      if (options.level) {
        const minPriority = LEVEL_PRIORITY[options.level.toUpperCase()] ?? 0;
        entries = timeline.filter(
          (e) => (LEVEL_PRIORITY[e.level] ?? 0) >= minPriority,
        );
      } else {
        entries = timeline;
      }
    } catch (err: unknown) {
      console.log(
        st.dim(
          `Could not fetch remote logs: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  }

  if (entries.length === 0) {
    console.log(st.dim(`No logs found for debate ${debateId}`));
    return;
  }

  console.log(border(`Logs: ${debateId}`));

  for (const entry of entries) {
    const color = colorForLevel(entry.level);
    const ts = formatTimestamp(entry.timestamp);
    const lvl = entry.level.padEnd(5);
    const msg = entry.message || "";
    console.log(contentLine(`${st.dim(ts)} ${color(lvl)} ${msg}`));
    if (entry.data) {
      console.log(contentLine(st.dim(`  ${JSON.stringify(entry.data)}`)));
    }
  }

  console.log(borderBottom());
}
