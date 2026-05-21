import chalk from "chalk";
import { terminal } from "./terminal-capabilities";
import { formatCodeBlock } from "./syntax-highlighter";

const FENCE_CLOSE = /^```\s*$/;
const FENCE_OPEN = /^```(\w*)\s*$/;

function tryHeading(line: string): string | undefined {
  if (/^###\s+/.test(line)) return chalk.bold.dim(line.replace(/^###\s+/, ""));
  if (/^##\s+/.test(line)) return chalk.bold(line.replace(/^##\s+/, ""));
  if (/^#\s+/.test(line))
    return chalk.bold.underline(line.replace(/^#\s+/, ""));
  return undefined;
}

function tryHorizontalRule(line: string): string | undefined {
  if (
    /^---\s*$/.test(line) ||
    /^\*\*\*\s*$/.test(line) ||
    /^___\s*$/.test(line)
  ) {
    return chalk.dim("─".repeat(terminal.width));
  }
  return undefined;
}

function tryQuote(line: string): string | undefined {
  if (/^>\s?/.test(line)) return chalk.dim(`  │ ${line.replace(/^>\s?/, "")}`);
  return undefined;
}

function tryBullet(line: string): string | undefined {
  if (!/^[-*]\s+/.test(line)) return undefined;
  return `  • ${applyInlineStyles(line.replace(/^[-*]\s+/, ""))}`;
}

function tryNumbered(line: string): string | undefined {
  if (!/^\d+\.\s+/.test(line)) return undefined;
  return applyInlineStyles(line);
}

const OUTSIDE_LINE_TRIERS: Array<(line: string) => string | undefined> = [
  tryHeading,
  tryHorizontalRule,
  tryQuote,
  tryBullet,
  tryNumbered,
];

interface FenceState {
  inCodeBlock: boolean;
  codeLines: string[];
  codeLang: string;
}

function consumeCodeBlockLine(
  line: string,
  s: FenceState,
  out: string[],
): void {
  if (FENCE_CLOSE.test(line)) {
    s.inCodeBlock = false;
    out.push(formatCodeBlock(s.codeLines.join("\n"), s.codeLang || undefined));
    s.codeLines = [];
    s.codeLang = "";
    return;
  }
  s.codeLines.push(line);
}

function tryOpenFence(line: string, s: FenceState): boolean {
  const m = FENCE_OPEN.exec(line);
  if (!m) return false;
  s.inCodeBlock = true;
  s.codeLang = m[1] ?? "";
  return true;
}

function emitOutsideLine(line: string, out: string[]): void {
  for (const tri of OUTSIDE_LINE_TRIERS) {
    const v = tri(line);
    if (v !== undefined) {
      out.push(v);
      return;
    }
  }
  if (line.trim() === "") {
    out.push("");
    return;
  }
  out.push(applyInlineStyles(line));
}

export function renderMarkdown(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  const s: FenceState = { inCodeBlock: false, codeLines: [], codeLang: "" };

  for (const line of lines) {
    if (s.inCodeBlock) {
      consumeCodeBlockLine(line, s, out);
      continue;
    }
    if (tryOpenFence(line, s)) continue;
    emitOutsideLine(line, out);
  }

  if (s.inCodeBlock && s.codeLines.length) {
    out.push(formatCodeBlock(s.codeLines.join("\n"), s.codeLang || undefined));
  }

  return out.join("\n");
}

const INLINE_CODE = /`([^`]{1,4000})`/g;
const BOLD = /\*\*([^*]{1,4000})\*\*/g;
const ITALIC_STAR = /(?<!\*)\*([^*]{1,4000})\*(?!\*)/g;
const ITALIC_UNDER = /(?<!_)_([^_]{1,4000})_(?!_)/g;
const LINK = /\[([^\]]{1,2000})\]\(([^)]{1,2000})\)/g;

function applyInlineStyles(text: string): string {
  let result = text;
  result = result.replaceAll(INLINE_CODE, (_, code: string) =>
    chalk.bgGray.white(` ${code} `),
  );
  result = result.replaceAll(BOLD, (_, bold: string) => chalk.bold(bold));
  result = result.replaceAll(ITALIC_STAR, (_, it: string) => chalk.italic(it));
  result = result.replaceAll(ITALIC_UNDER, (_, it: string) => chalk.italic(it));
  result = result.replaceAll(LINK, (_, label: string, url: string) => {
    const dimUrl = chalk.dim("(" + url + ")");
    return `${label} ${dimUrl}`;
  });
  return result;
}

export function stripMarkdown(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (inCodeBlock) {
      if (FENCE_CLOSE.test(line)) {
        inCodeBlock = false;
      } else {
        out.push(line);
      }
      continue;
    }
    if (line.startsWith("```")) {
      inCodeBlock = true;
      continue;
    }

    let cleaned = line;
    cleaned = cleaned.replace(/^#{1,6}\s+/, "");
    cleaned = cleaned.replace(/^>\s?/, "");
    cleaned = cleaned.replace(/^[-*]\s+/, "- ");
    cleaned = cleaned.replace(/^(---|\*\*\*|___)\s*$/, "---");
    cleaned = cleaned.replaceAll(INLINE_CODE, "$1");
    cleaned = cleaned.replaceAll(BOLD, "$1");
    cleaned = cleaned.replaceAll(ITALIC_STAR, "$1");
    cleaned = cleaned.replaceAll(ITALIC_UNDER, "$1");
    cleaned = cleaned.replaceAll(LINK, "$1 ($2)");
    out.push(cleaned);
  }

  return out.join("\n");
}
