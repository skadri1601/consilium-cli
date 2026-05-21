import fs from "node:fs";
import path from "node:path";

/**
 * Per-project memory: an append-only markdown log of past debates the
 * council has run on this codebase. Persists to ".consilium/memory.md"
 * inside the project root so it travels with the repo (or is ignored
 * via .gitignore - that's the user's call).
 *
 * The point: when a user runs a 5th debate in the same project, the
 * council shouldn't re-derive context from scratch. They get a short
 * preamble of what was already decided and what golden prompts were
 * generated, so the new debate can build on prior conclusions.
 */

const MEMORY_DIR = ".consilium";
const MEMORY_FILE = "memory.md";
const MAX_ENTRIES_IN_PROMPT = 5;
const MAX_SUMMARY_CHARS = 500;
const MAX_FILE_BYTES = 256 * 1024;

export interface MemoryEntry {
  ts: string;
  topic: string;
  mode: string;
  summary: string;
  debateId?: string;
}

function memoryPath(rootPath: string): string {
  return path.join(rootPath, MEMORY_DIR, MEMORY_FILE);
}

function ensureMemoryDir(rootPath: string): void {
  const dir = path.join(rootPath, MEMORY_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function summarize(text: string): string {
  if (!text) return "";
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= MAX_SUMMARY_CHARS) return cleaned;
  return cleaned.slice(0, MAX_SUMMARY_CHARS - 1) + "…";
}

function formatEntry(entry: MemoryEntry): string {
  const id = entry.debateId ? `  \n_id: ${entry.debateId}_` : "";
  return [
    `## ${entry.ts} - ${entry.mode}${id}`,
    "",
    `**Topic:** ${entry.topic}`,
    "",
    entry.summary,
    "",
    "---",
    "",
  ].join("\n");
}

/** Parse the memory file into structured entries (best-effort). */
export function loadProjectMemory(rootPath: string): MemoryEntry[] {
  const file = memoryPath(rootPath);
  if (!fs.existsSync(file)) return [];

  let raw: string;
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_FILE_BYTES) {
      // Pathological case - file got huge. Read tail so we still get
      // recent entries, drop the rest. The user can manually rotate.
      const fd = fs.openSync(file, "r");
      try {
        const buf = Buffer.alloc(MAX_FILE_BYTES);
        fs.readSync(fd, buf, 0, MAX_FILE_BYTES, stat.size - MAX_FILE_BYTES);
        raw = buf.toString("utf-8");
      } finally {
        fs.closeSync(fd);
      }
    } else {
      raw = fs.readFileSync(file, "utf-8");
    }
  } catch {
    return [];
  }

  const entries: MemoryEntry[] = [];
  const sections = raw.split(/\n## /);
  for (const section of sections) {
    if (!section.trim()) continue;
    const body = section.startsWith("## ") ? section.slice(3) : section;
    const headerMatch = /^([\dT:.\-Z]+)\s+-\s+(\w+)/.exec(body);
    if (!headerMatch) continue;
    const ts = headerMatch[1] ?? "";
    const mode = headerMatch[2] ?? "";
    const topicMatch = /\*\*Topic:\*\*\s+([^\n]+)/.exec(body);
    const topic = topicMatch?.[1]?.trim() ?? "";
    const idMatch = /_id:\s+(\S+?)_(?=\s|$)/m.exec(body);
    const summaryStart = body.indexOf("**Topic:**");
    const summaryAfterTopic =
      summaryStart >= 0 ? body.slice(summaryStart) : body;
    const blankIdx = summaryAfterTopic.indexOf("\n\n");
    const restAfterTopic =
      blankIdx >= 0 ? summaryAfterTopic.slice(blankIdx + 2) : "";
    const cutoff = restAfterTopic.indexOf("\n---");
    const summary = (
      cutoff >= 0 ? restAfterTopic.slice(0, cutoff) : restAfterTopic
    ).trim();
    if (!ts || !topic) continue;
    entries.push({ ts, mode, topic, summary, debateId: idMatch?.[1] });
  }
  return entries;
}

export function appendProjectMemory(
  rootPath: string,
  entry: Omit<MemoryEntry, "ts"> & { ts?: string },
): void {
  ensureMemoryDir(rootPath);
  const file = memoryPath(rootPath);
  const ts = entry.ts ?? new Date().toISOString();
  const finalEntry: MemoryEntry = {
    ts,
    topic: entry.topic.slice(0, 300),
    mode: entry.mode,
    summary: summarize(entry.summary),
    debateId: entry.debateId,
  };

  const isNewFile = !fs.existsSync(file);
  const header = isNewFile
    ? "# Consilium Project Memory\n\nAuto-generated log of past debates the council has run in this project. Newest entries at the bottom. Safe to commit, hand-edit, or .gitignore - your call.\n\n"
    : "";
  const block = formatEntry(finalEntry);
  fs.appendFileSync(file, header + block, "utf-8");
}

/**
 * Render the most recent N entries as a prompt prefix that can be
 * prepended to the next debate's topic. Returns empty string when no
 * memory exists so callers don't have to special-case.
 */
export function formatMemoryForPrompt(
  rootPath: string,
  limit = MAX_ENTRIES_IN_PROMPT,
): { text: string; count: number } {
  const entries = loadProjectMemory(rootPath);
  if (entries.length === 0) return { text: "", count: 0 };
  const recent = entries.slice(-limit);
  const lines: string[] = [
    "",
    "## Prior Council Decisions in This Project",
    "",
  ];
  for (const e of recent) {
    lines.push(`- **[${e.mode}] ${e.topic}** - ${e.summary.slice(0, 240)}`);
  }
  lines.push(
    "",
    "_(End of prior decisions. Use them to stay consistent unless the new request explicitly contradicts.)_",
    "",
    "",
  );
  return { text: lines.join("\n"), count: entries.length };
}

export function memoryFileExists(rootPath: string): boolean {
  return fs.existsSync(memoryPath(rootPath));
}

export function memoryFilePath(rootPath: string): string {
  return memoryPath(rootPath);
}
