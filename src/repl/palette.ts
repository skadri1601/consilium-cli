import { ALL_COMMANDS, filterCommands, type SlashCommand } from "./commands.js";
import { style } from "../utils/visual-system.js";
import { terminal } from "../utils/terminal-capabilities.js";

const st = style();

const MAX_VISIBLE = 8;

export interface PaletteState {
  buffer: string;
  paletteIndex: number;
  prevLines: number;
}

export function createState(): PaletteState {
  return { buffer: "", paletteIndex: 0, prevLines: 0 };
}

export function isPaletteOpen(buffer: string): boolean {
  if (!buffer.startsWith("/")) return false;
  return !buffer.includes(" ");
}

export function paletteQuery(buffer: string): string {
  return buffer.startsWith("/") ? buffer.slice(1) : "";
}

export function visibleMatches(buffer: string): SlashCommand[] {
  if (!isPaletteOpen(buffer)) return [];
  return filterCommands(paletteQuery(buffer));
}

function widestUsage(items: SlashCommand[]): number {
  let max = 0;
  for (const c of items) {
    const u = (c.usage ?? `/${c.name}`).length;
    if (u > max) max = u;
  }
  return max;
}

function clipLine(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)) + "…";
}

function renderPalette(buffer: string, paletteIndex: number): string {
  const matches = visibleMatches(buffer);
  if (matches.length === 0) {
    return `\n  ${st.dim("(no matching commands - press esc to dismiss)")}\n`;
  }
  const widest = widestUsage(ALL_COMMANDS);
  const totalCols = Math.max(40, terminal.width);

  let scrollStart = 0;
  if (matches.length > MAX_VISIBLE) {
    scrollStart = Math.max(
      0,
      Math.min(
        paletteIndex - Math.floor(MAX_VISIBLE / 2),
        matches.length - MAX_VISIBLE,
      ),
    );
  }
  const scrollEnd = Math.min(scrollStart + MAX_VISIBLE, matches.length);

  const lines: string[] = [""];
  if (scrollStart > 0) {
    lines.push(`     ${st.dim(`↑ ${scrollStart} more`)}`);
  }
  for (let i = scrollStart; i < scrollEnd; i++) {
    const cmd = matches[i]!;
    const usage = cmd.usage ?? `/${cmd.name}`;
    const usagePadded = usage.padEnd(widest + 2);
    const isSel = i === paletteIndex;
    const arrow = isSel ? st.brand("❯ ") : "  ";
    const summaryRoom = Math.max(10, totalCols - widest - 8);
    const summary = clipLine(cmd.summary, summaryRoom);
    if (isSel) {
      lines.push(`  ${arrow}${st.brand(usagePadded)}${summary}`);
    } else {
      lines.push(`  ${arrow}${st.dim(usagePadded)}${st.dim(summary)}`);
    }
  }
  if (scrollEnd < matches.length) {
    lines.push(`     ${st.dim(`↓ ${matches.length - scrollEnd} more`)}`);
  }
  lines.push(
    `     ${st.dim("↑↓ navigate · enter selects · esc dismiss · tab completes")}`,
  );
  return lines.join("\n") + "\n";
}

export function renderPrompt(buffer: string): string {
  const cols = Math.max(40, terminal.width);
  const rule = st.dim("─".repeat(cols));
  const hint = buffer.length === 0 ? `\n  ${st.dim("? for shortcuts")}` : "";
  return `${rule}\n${st.brand("❯")} ${buffer}${hint}`;
}

export function renderFrame(state: PaletteState): {
  frame: string;
  lines: number;
} {
  const palette = isPaletteOpen(state.buffer)
    ? renderPalette(state.buffer, state.paletteIndex)
    : "";
  const frame = palette + renderPrompt(state.buffer);
  const lines = frame.match(/\n/g)?.length ?? 0;
  return { frame, lines };
}

export function clampPaletteIndex(state: PaletteState): void {
  const matches = visibleMatches(state.buffer);
  if (matches.length === 0) {
    state.paletteIndex = 0;
    return;
  }
  if (state.paletteIndex >= matches.length) {
    state.paletteIndex = matches.length - 1;
  }
  if (state.paletteIndex < 0) state.paletteIndex = 0;
}
