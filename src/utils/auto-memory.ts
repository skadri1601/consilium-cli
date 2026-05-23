import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export interface ProjectMemory {
  projectHash: string;
  projectPath: string;
  createdAt: number;
  updatedAt: number;
  notes: MemoryNote[];
  preferences: Record<string, unknown>;
}

export interface MemoryNote {
  timestamp: number;
  topic: string;
  insight: string;
  source?: string;
}

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_INSIGHT_CHARS = 600;
const DEFAULT_MAX_LINES = 25;

function projectHash(absolutePath: string): string {
  return crypto
    .createHash("sha256")
    .update(absolutePath)
    .digest("hex")
    .slice(0, 12);
}

function resolveProjectPath(projectPath?: string): string {
  const target = projectPath ?? process.cwd();
  return path.resolve(target);
}

export function getMemoryPath(projectPath?: string): string {
  const resolved = resolveProjectPath(projectPath);
  const hash = projectHash(resolved);
  return path.join(os.homedir(), ".consilium", "projects", hash, "MEMORY.md");
}

function getMemoryDir(projectPath?: string): string {
  return path.dirname(getMemoryPath(projectPath));
}

function escapeFrontmatter(value: string): string {
  return value.replace(/"/g, '\\"');
}

function serializeNote(note: MemoryNote): string {
  const date = new Date(note.timestamp).toISOString();
  const source = note.source ? ` _(source: ${note.source})_` : "";
  const topic = note.topic.replace(/[\r\n]+/g, " ").trim();
  const insight = note.insight.replace(/[\r\n]+/g, " ").trim();
  return `- **${date}** \`${topic}\` - ${insight}${source}`;
}

function parseFrontmatter(raw: string): {
  meta: Partial<ProjectMemory>;
  body: string;
} {
  if (!raw.startsWith("---\n")) return { meta: {}, body: raw };
  const end = raw.indexOf("\n---", 4);
  if (end < 0) return { meta: {}, body: raw };
  const header = raw.slice(4, end);
  const body = raw.slice(end + 4).replace(/^\n+/, "");
  const meta: Record<string, unknown> = {};
  for (const line of header.split("\n")) {
    const match = /^([a-zA-Z_]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    let value: string = match[2] ?? "";
    if (!key) continue;
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\"/g, '"');
    }
    if (key === "createdAt" || key === "updatedAt") {
      const num = Number(value);
      meta[key] = Number.isFinite(num) ? num : 0;
    } else if (key === "preferences") {
      try {
        meta[key] = JSON.parse(value) as Record<string, unknown>;
      } catch {
        meta[key] = {};
      }
    } else {
      meta[key] = value;
    }
  }
  return { meta: meta as Partial<ProjectMemory>, body };
}

function parseNotes(body: string): MemoryNote[] {
  const notes: MemoryNote[] = [];
  const lines = body.split("\n");
  let inNotes = false;
  for (const line of lines) {
    if (/^##\s+Notes\s*$/i.test(line.trim())) {
      inNotes = true;
      continue;
    }
    if (!inNotes) continue;
    if (line.startsWith("## ")) break;
    const match =
      /^- \*\*([^*]+)\*\*\s+`([^`]*)`\s+-\s+(.+?)(?:\s+_\(source:\s+([^)]+)\)_)?\s*$/.exec(
        line,
      );
    if (!match) continue;
    const isoTs = match[1];
    const topic = match[2];
    const insight = match[3];
    const source = match[4];
    if (!isoTs || !topic || !insight) continue;
    const ts = Date.parse(isoTs);
    if (!Number.isFinite(ts)) continue;
    notes.push({
      timestamp: ts,
      topic,
      insight,
      ...(source ? { source } : {}),
    });
  }
  return notes;
}

export function loadMemory(projectPath?: string): ProjectMemory | null {
  const file = getMemoryPath(projectPath);
  if (!fs.existsSync(file)) return null;
  let raw: string;
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_FILE_BYTES) {
      raw = fs.readFileSync(file, "utf-8").slice(-MAX_FILE_BYTES);
    } else {
      raw = fs.readFileSync(file, "utf-8");
    }
  } catch {
    return null;
  }
  const { meta, body } = parseFrontmatter(raw);
  const resolved = resolveProjectPath(projectPath);
  const hash = projectHash(resolved);
  const notes = parseNotes(body);
  return {
    projectHash: typeof meta.projectHash === "string" ? meta.projectHash : hash,
    projectPath:
      typeof meta.projectPath === "string" ? meta.projectPath : resolved,
    createdAt: typeof meta.createdAt === "number" ? meta.createdAt : Date.now(),
    updatedAt: typeof meta.updatedAt === "number" ? meta.updatedAt : Date.now(),
    notes,
    preferences:
      meta.preferences && typeof meta.preferences === "object"
        ? (meta.preferences as Record<string, unknown>)
        : {},
  };
}

function writeMemory(memory: ProjectMemory): void {
  const file = getMemoryPath(memory.projectPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const frontmatter = [
    "---",
    `projectHash: ${memory.projectHash}`,
    `projectPath: "${escapeFrontmatter(memory.projectPath)}"`,
    `createdAt: ${memory.createdAt}`,
    `updatedAt: ${memory.updatedAt}`,
    `preferences: ${JSON.stringify(memory.preferences ?? {})}`,
    "---",
    "",
  ].join("\n");
  const header =
    "# Consilium Project Memory\n\nAuto-generated notes about this project. Append-only.\n\n## Notes\n\n";
  const noteLines = memory.notes.map(serializeNote).join("\n");
  const trailing = noteLines.length > 0 ? "\n" : "";
  fs.writeFileSync(file, frontmatter + header + noteLines + trailing, "utf-8");
}

export function appendMemoryNote(
  note: Omit<MemoryNote, "timestamp">,
  projectPath?: string,
): void {
  const resolved = resolveProjectPath(projectPath);
  const hash = projectHash(resolved);
  fs.mkdirSync(getMemoryDir(projectPath), { recursive: true });

  const trimmedInsight = note.insight.trim().slice(0, MAX_INSIGHT_CHARS);
  const trimmedTopic = note.topic.trim().slice(0, 200);
  if (!trimmedInsight || !trimmedTopic) return;

  const now = Date.now();
  const existing = loadMemory(projectPath);
  const memory: ProjectMemory = existing
    ? {
        ...existing,
        updatedAt: now,
        notes: [
          ...existing.notes,
          {
            timestamp: now,
            topic: trimmedTopic,
            insight: trimmedInsight,
            ...(note.source ? { source: note.source } : {}),
          },
        ],
      }
    : {
        projectHash: hash,
        projectPath: resolved,
        createdAt: now,
        updatedAt: now,
        notes: [
          {
            timestamp: now,
            topic: trimmedTopic,
            insight: trimmedInsight,
            ...(note.source ? { source: note.source } : {}),
          },
        ],
        preferences: {},
      };
  writeMemory(memory);
}

export function renderMemoryForPrompt(
  memory: ProjectMemory,
  maxLines: number = DEFAULT_MAX_LINES,
): string {
  if (!memory.notes.length) {
    return `Project memory: ${memory.projectPath}\n(No notes yet.)`;
  }
  const recent = memory.notes.slice(-maxLines);
  const lines: string[] = [
    `Project memory: ${memory.projectPath}`,
    `Notes (${recent.length} of ${memory.notes.length}):`,
    "",
  ];
  for (const note of recent) {
    const date = new Date(note.timestamp).toISOString().slice(0, 10);
    const src = note.source ? ` [${note.source}]` : "";
    lines.push(`- ${date} ${note.topic}: ${note.insight}${src}`);
  }
  return lines.join("\n");
}

const EXTRACTOR_PATTERNS: Array<{ kind: string; regex: RegExp }> = [
  {
    kind: "preference",
    regex: /\b(?:the\s+user|user)\s+prefers?\s+([^.\n!?]{4,300})[.!?\n]/i,
  },
  { kind: "constraint", regex: /\bconstraint\s*:\s*([^.\n!?]{4,300})[.!?\n]/i },
  { kind: "remember", regex: /\bremember\s*:\s*([^.\n!?]{4,300})[.!?\n]/i },
  { kind: "decision", regex: /\bdecision\s*:\s*([^.\n!?]{4,300})[.!?\n]/i },
];

export interface ExtractedInsight {
  kind: string;
  insight: string;
}

const MAX_EXTRACTED_LENGTH = 200;
const CONTROL_CHAR_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?previous/i,
  /\bsystem\s*:/i,
  /\boverride\s+instructions/i,
  /\byou\s+are\s+now\b/i,
  /\bforget\s+(?:all|everything|your)\b/i,
];

function sanitizeExtracted(raw: string): string | null {
  let cleaned = raw.trim().replace(/\s+/g, " ").replace(CONTROL_CHAR_RE, "");
  cleaned = cleaned.slice(0, MAX_EXTRACTED_LENGTH);
  if (cleaned.length < 4) return null;
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(cleaned)) return null;
  }
  return cleaned;
}

export function extractInsightFromSynthesis(
  synthesis: string,
): ExtractedInsight | null {
  if (!synthesis) return null;
  const text = synthesis.replace(/\r\n/g, "\n");
  for (const { kind, regex } of EXTRACTOR_PATTERNS) {
    const match = regex.exec(text);
    if (match && match[1]) {
      const insight = sanitizeExtracted(match[1]);
      if (insight) {
        return { kind, insight };
      }
    }
  }
  return null;
}

export function maybeAppendFromSynthesis(opts: {
  topic: string;
  synthesis: string;
  source?: string;
  projectPath?: string;
}): MemoryNote | null {
  const extracted = extractInsightFromSynthesis(opts.synthesis);
  if (!extracted) return null;
  const insight = `${extracted.kind}: ${extracted.insight}`;
  appendMemoryNote(
    {
      topic: opts.topic,
      insight,
      ...(opts.source ? { source: opts.source } : {}),
    },
    opts.projectPath,
  );
  const memory = loadMemory(opts.projectPath);
  return memory?.notes.at(-1) ?? null;
}
