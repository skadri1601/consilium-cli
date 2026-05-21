/**
 * Detect terminal capabilities for graceful fallbacks.
 * Used by stream-renderer, progress, and boxen to avoid broken output.
 */

const isWindows = process.platform === "win32";
const isCI = Boolean(process.env.CI || process.env.GITHUB_ACTIONS);
const isTTY = Boolean(process.stdout?.isTTY);
const hasColor =
  isTTY &&
  (process.env.FORCE_COLOR === "1" ||
    process.env.FORCE_COLOR === "true" ||
    (typeof (process.stdout as { hasColors?: (count?: number) => boolean })
      .hasColors === "function" &&
      (process.stdout as { hasColors: (count?: number) => boolean }).hasColors(
        16,
      )));
const hasUnicode = isTTY && (process.env.TERM?.includes("utf") ?? !isWindows);

export const terminal = {
  isWindows,
  isCI,
  isTTY,
  hasColor: hasColor ?? true,
  hasUnicode: hasUnicode ?? true,
  /** Prefer plain text (no boxes/unicode) in CI or non-TTY */
  usePlain: isCI || !isTTY,
  /** Width; fallback 80 */
  width:
    process.stdout?.columns && process.stdout.columns > 0
      ? Math.min(process.stdout.columns, 120)
      : 80,
};

export type BoxStyle = "sharp" | "rounded";

export function boxChars(style: BoxStyle = "sharp"): {
  horizontal: string;
  vertical: string;
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
} {
  if (terminal.usePlain || !terminal.hasUnicode) {
    return {
      horizontal: "-",
      vertical: "|",
      topLeft: "+",
      topRight: "+",
      bottomLeft: "+",
      bottomRight: "+",
    };
  }
  if (style === "rounded") {
    return {
      horizontal: "\u2500",
      vertical: "\u2502",
      topLeft: "\u256d",
      topRight: "\u256e",
      bottomLeft: "\u2570",
      bottomRight: "\u256f",
    };
  }
  return {
    horizontal: "\u2500",
    vertical: "\u2502",
    topLeft: "\u250c",
    topRight: "\u2510",
    bottomLeft: "\u2514",
    bottomRight: "\u2518",
  };
}
