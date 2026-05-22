import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SubAgentDef, SubAgentFrontmatter } from "./types";

const AGENTS_DIR = path.join(os.homedir(), ".consilium", "agents");

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const NAME_FILE_RE = /^[a-zA-Z0-9._-]+$/;

export function getUserSubAgentsDir(): string {
  return AGENTS_DIR;
}

interface ParsedMd {
  frontmatter: Record<string, unknown>;
  body: string;
}

function parseFrontmatter(raw: string): ParsedMd | null {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return null;
  const block = match[1] ?? "";
  const body = match[2] ?? "";
  const frontmatter: Record<string, unknown> = {};
  const lines = block.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    i++;
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const kvMatch = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kvMatch) continue;
    const key = kvMatch[1]!;
    const rawValue = kvMatch[2] ?? "";
    if (rawValue.trim() === "") {
      const items: string[] = [];
      while (i < lines.length) {
        const next = lines[i] ?? "";
        const itemMatch = next.match(/^\s*-\s+(.+)\s*$/);
        if (!itemMatch) break;
        items.push(stripScalar(itemMatch[1]!));
        i++;
      }
      frontmatter[key] = items;
      continue;
    }
    if (rawValue.trim().startsWith("[") && rawValue.trim().endsWith("]")) {
      frontmatter[key] = parseInlineArray(rawValue.trim());
      continue;
    }
    frontmatter[key] = stripScalar(rawValue);
  }
  return { frontmatter, body: body.replace(/^\r?\n+/, "") };
}

function stripScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseInlineArray(value: string): string[] {
  const inner = value.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(",").map((item) => stripScalar(item));
}

function normalizeFrontmatter(
  fm: Record<string, unknown>,
): SubAgentFrontmatter | null {
  const name = typeof fm.name === "string" ? fm.name.trim() : "";
  const description =
    typeof fm.description === "string" ? fm.description.trim() : "";
  if (!name || !description) return null;
  const model =
    typeof fm.model === "string" && fm.model.trim() !== ""
      ? fm.model.trim()
      : undefined;
  const allowedRaw = fm["allowed-tools"] ?? fm["allowedTools"];
  let allowedTools: string[] | undefined;
  if (Array.isArray(allowedRaw)) {
    allowedTools = allowedRaw
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  } else if (typeof allowedRaw === "string" && allowedRaw.trim() !== "") {
    allowedTools = allowedRaw
      .split(",")
      .map((v) => stripScalar(v).trim())
      .filter((v) => v.length > 0);
  }
  return { name, description, model, allowedTools };
}

export async function loadUserSubAgents(
  dir: string = AGENTS_DIR,
): Promise<SubAgentDef[]> {
  if (!fs.existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return [];
  }
  const out: SubAgentDef[] = [];
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith(".md")) continue;
    const filePath = path.join(dir, entry);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const baseName = entry.replace(/\.md$/i, "");
    if (!NAME_FILE_RE.test(baseName)) continue;

    let raw: string;
    try {
      raw = await fs.promises.readFile(filePath, "utf-8");
    } catch {
      continue;
    }
    const parsed = parseFrontmatter(raw);
    if (!parsed) {
      console.warn(
        `[consilium sub-agents] skipping ${filePath}: missing frontmatter`,
      );
      continue;
    }
    const fm = normalizeFrontmatter(parsed.frontmatter);
    if (!fm) {
      console.warn(
        `[consilium sub-agents] skipping ${filePath}: name and description are required`,
      );
      continue;
    }
    if (fm.name !== baseName) {
      console.warn(
        `[consilium sub-agents] skipping ${filePath}: frontmatter name "${fm.name}" does not match filename "${baseName}"`,
      );
      continue;
    }
    const body = parsed.body.trim();
    if (!body) {
      console.warn(
        `[consilium sub-agents] skipping ${filePath}: body is empty`,
      );
      continue;
    }
    out.push({
      name: fm.name,
      description: fm.description,
      model: fm.model,
      allowedTools: fm.allowedTools,
      systemPrompt: body,
      filePath,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function findSubAgent(
  name: string,
  dir: string = AGENTS_DIR,
): Promise<SubAgentDef | null> {
  const all = await loadUserSubAgents(dir);
  return all.find((a) => a.name === name) ?? null;
}

/**
 * Invokes a user sub-agent. Throws because backend support for per-sub-agent
 * systemPrompt routing is not yet wired (CLI loader only — see plan W6).
 */
export async function invokeSubAgent(
  _name: string,
  _prompt: string,
): Promise<string> {
  throw new Error(
    "sub-agent invocation requires backend support — config loaded but not yet runnable",
  );
}
