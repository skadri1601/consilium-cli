export type SegmentColor = "system" | "user" | "assistant" | "tool" | "memory";

export interface TokenSegment {
  label: string;
  tokens: number;
  color?: SegmentColor;
}

export interface TokenUsage {
  used: number;
  limit: number;
  segments?: TokenSegment[];
}

export interface GridOptions {
  width?: number;
  height?: number;
}

const ANSI_RESET = "\x1b[0m";

const COLOR_CODES: Record<SegmentColor | "free", string> = {
  system: "\x1b[34m",
  user: "\x1b[32m",
  assistant: "\x1b[36m",
  tool: "\x1b[33m",
  memory: "\x1b[35m",
  free: "\x1b[2;37m",
};

const SWATCH_CODES: Record<SegmentColor | "free", string> = {
  system: "\x1b[44m",
  user: "\x1b[42m",
  assistant: "\x1b[46m",
  tool: "\x1b[43m",
  memory: "\x1b[45m",
  free: "\x1b[100m",
};

const FILLED_CELL = "█";
const EMPTY_CELL = "░";
const SWATCH = " ";

const DEFAULT_WIDTH = 60;
const DEFAULT_HEIGHT = 8;

function paintCell(char: string, color: SegmentColor | "free"): string {
  return `${COLOR_CODES[color]}${char}${ANSI_RESET}`;
}

function paintSwatch(color: SegmentColor | "free"): string {
  return `${SWATCH_CODES[color]}${SWATCH}${SWATCH}${ANSI_RESET}`;
}

function formatNumber(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function clampUsage(usage: TokenUsage): {
  used: number;
  limit: number;
  segments: TokenSegment[];
} {
  const limit = Math.max(1, Math.floor(usage.limit));
  const used = Math.max(0, Math.min(limit, Math.floor(usage.used)));
  const segments = (usage.segments ?? []).map((s) => ({
    label: s.label,
    tokens: Math.max(0, Math.floor(s.tokens)),
    color: s.color,
  }));
  return { used, limit, segments };
}

function buildCellColors(
  totalCells: number,
  filledCells: number,
  segments: TokenSegment[],
  tokensPerCell: number,
): Array<SegmentColor | "free"> {
  const cells: Array<SegmentColor | "free"> = new Array(totalCells).fill(
    "free",
  );
  if (filledCells === 0) return cells;

  if (segments.length === 0) {
    for (let i = 0; i < filledCells; i += 1) {
      cells[i] = "assistant";
    }
    return cells;
  }

  let cursor = 0;
  for (const seg of segments) {
    if (cursor >= filledCells) break;
    const color: SegmentColor = seg.color ?? "assistant";
    let cellCount = Math.round(seg.tokens / tokensPerCell);
    if (seg.tokens > 0 && cellCount === 0) cellCount = 1;
    const end = Math.min(filledCells, cursor + cellCount);
    for (let i = cursor; i < end; i += 1) {
      cells[i] = color;
    }
    cursor = end;
  }
  for (let i = cursor; i < filledCells; i += 1) {
    cells[i] = "assistant";
  }
  return cells;
}

function buildLegend(usage: {
  used: number;
  limit: number;
  segments: TokenSegment[];
}): string {
  const parts: string[] = [];
  for (const seg of usage.segments) {
    const color = seg.color ?? "assistant";
    parts.push(
      `${paintSwatch(color)} ${seg.label} ${formatNumber(seg.tokens)}`,
    );
  }
  const free = usage.limit - usage.used;
  parts.push(`${paintSwatch("free")} free ${formatNumber(free)}`);
  return parts.join("   ");
}

export function renderContextSummary(usage: TokenUsage): string {
  const u = clampUsage(usage);
  const pct = Math.round((u.used / u.limit) * 100);
  return `Context: ${formatNumber(u.used)} / ${formatNumber(u.limit)} tokens (${pct}%)`;
}

export function renderContextGrid(
  usage: TokenUsage,
  opts: GridOptions = {},
): string {
  const width = Math.max(10, Math.floor(opts.width ?? DEFAULT_WIDTH));
  const height = Math.max(1, Math.floor(opts.height ?? DEFAULT_HEIGHT));
  const u = clampUsage(usage);
  const totalCells = width * height;
  const tokensPerCell = Math.ceil(u.limit / totalCells);
  const ratio = u.used / u.limit;
  let filledCells = Math.round(ratio * totalCells);
  if (u.used > 0 && filledCells === 0) filledCells = 1;
  if (filledCells > totalCells) filledCells = totalCells;

  const cellColors = buildCellColors(
    totalCells,
    filledCells,
    u.segments,
    tokensPerCell,
  );

  const lines: string[] = [];
  lines.push(renderContextSummary(usage));

  const horizontal = "─".repeat(width);
  lines.push(`┌${horizontal}┐`);
  for (let row = 0; row < height; row += 1) {
    const rowChars: string[] = [];
    for (let col = 0; col < width; col += 1) {
      const idx = row * width + col;
      const color = cellColors[idx] ?? "free";
      const char = color === "free" ? EMPTY_CELL : FILLED_CELL;
      rowChars.push(paintCell(char, color));
    }
    lines.push(`│${rowChars.join("")}│`);
  }
  lines.push(`└${horizontal}┘`);
  lines.push(buildLegend(u));
  return lines.join("\n");
}
