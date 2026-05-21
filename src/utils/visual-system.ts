/**
 * Design tokens for Consilium CLI: colors, borders, spinners.
 * Professional palette, minimal AI branding.
 */

import chalk from "chalk";
import { terminal, boxChars } from "./terminal-capabilities";

export const COLORS = {
  brand: "#6366f1",
  success: "#10b981",
  error: "#ef4444",
  warning: "#f59e0b",
  text: {
    primary: "#e5e7eb",
    secondary: "#9ca3af",
    tertiary: "#6b7280",
  },
} as const;

export const SPINNERS = {
  main: "dots12",
  subtle: "dots",
  thinking: "arc",
} as const;

/** Chalk helpers using palette (respects terminal.hasColor) */
export function style() {
  if (!terminal.hasColor) {
    return {
      brand: (s: string) => s,
      success: (s: string) => s,
      error: (s: string) => s,
      warning: (s: string) => s,
      dim: (s: string) => s,
      bold: (s: string) => s,
    };
  }
  return {
    brand: (s: string) => chalk.hex(COLORS.brand)(s),
    success: (s: string) => chalk.hex(COLORS.success)(s),
    error: (s: string) => chalk.hex(COLORS.error)(s),
    warning: (s: string) => chalk.hex(COLORS.warning)(s),
    dim: (s: string) => chalk.hex(COLORS.text.tertiary)(s),
    bold: (s: string) => chalk.bold(s),
  };
}

/** Build a simple box border (no boxen dep for minimal layout) */
export function border(title: string, width: number = terminal.width): string {
  const bc = boxChars();
  const pad = Math.max(0, width - title.length - 6);
  const line = bc.horizontal.repeat(Math.max(0, pad));
  return `${bc.topLeft}${bc.horizontal} ${title} ${line}${bc.topRight}`;
}

export function borderBottom(width: number = terminal.width): string {
  const bc = boxChars();
  return `${bc.bottomLeft}${bc.horizontal.repeat(Math.max(0, width - 2))}${bc.bottomRight}`;
}

export function borderLine(width: number = terminal.width): string {
  const bc = boxChars();
  return `${bc.vertical}${" ".repeat(Math.max(0, width - 2))}${bc.vertical}`;
}

export function contentLine(
  text: string,
  width: number = terminal.width,
): string {
  const bc = boxChars();
  const w = Math.max(0, width - 4);
  const truncated = text.length <= w ? text : text.slice(0, w - 3) + "…";
  return `${bc.vertical} ${truncated.padEnd(w - 1)} ${bc.vertical}`;
}

/** Rounded box (for agent cards) */
export function borderRounded(
  title: string,
  width: number = terminal.width,
): string {
  const bc = boxChars("rounded");
  const pad = Math.max(0, width - title.length - 6);
  const line = bc.horizontal.repeat(Math.max(0, pad));
  return `${bc.topLeft}${bc.horizontal} ${title} ${line}${bc.topRight}`;
}

export function borderBottomRounded(width: number = terminal.width): string {
  const bc = boxChars("rounded");
  return `${bc.bottomLeft}${bc.horizontal.repeat(Math.max(0, width - 2))}${bc.bottomRight}`;
}

export function borderLineRounded(width: number = terminal.width): string {
  const bc = boxChars("rounded");
  return `${bc.vertical}${" ".repeat(Math.max(0, width - 2))}${bc.vertical}`;
}

export function contentLineRounded(
  text: string,
  width: number = terminal.width,
): string {
  const bc = boxChars("rounded");
  const w = Math.max(0, width - 4);
  const truncated = text.length <= w ? text : text.slice(0, w - 3) + "…";
  return `${bc.vertical} ${truncated.padEnd(w - 1)} ${bc.vertical}`;
}
