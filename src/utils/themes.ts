import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { terminal } from "./terminal-capabilities";

export interface Theme {
  brand: (s: string) => string;
  dim: (s: string) => string;
  success: (s: string) => string;
  warning: (s: string) => string;
  error: (s: string) => string;
  bold: (s: string) => string;
}

export interface ThemePalette {
  brand: string;
  success: string;
  error: string;
  warning: string;
  text: string;
  dimText: string;
}

const CONFIG_DIR = path.join(os.homedir(), ".consilium");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

const PALETTES: Record<string, ThemePalette> = {
  default: {
    brand: "#6366f1",
    success: "#10b981",
    error: "#ef4444",
    warning: "#f59e0b",
    text: "#e5e7eb",
    dimText: "#6b7280",
  },
  dark: {
    brand: "#818cf8",
    success: "#34d399",
    error: "#f87171",
    warning: "#fbbf24",
    text: "#f3f4f6",
    dimText: "#9ca3af",
  },
  light: {
    brand: "#4f46e5",
    success: "#059669",
    error: "#dc2626",
    warning: "#d97706",
    text: "#111827",
    dimText: "#4b5563",
  },
  "high-contrast": {
    brand: "#ffffff",
    success: "#00ff00",
    error: "#ff0000",
    warning: "#ffff00",
    text: "#ffffff",
    dimText: "#cccccc",
  },
  matrix: {
    brand: "#00ff41",
    success: "#00ff41",
    error: "#ff5555",
    warning: "#f1fa8c",
    text: "#a8ffb0",
    dimText: "#007f1f",
  },
  ocean: {
    brand: "#22d3ee",
    success: "#10b981",
    error: "#f87171",
    warning: "#fbbf24",
    text: "#cffafe",
    dimText: "#155e75",
  },
  sunset: {
    brand: "#d946ef",
    success: "#fbbf24",
    error: "#ef4444",
    warning: "#fb923c",
    text: "#fde68a",
    dimText: "#fb923c",
  },
  monokai: {
    brand: "#fd971f",
    success: "#a6e22e",
    error: "#f92672",
    warning: "#e6db74",
    text: "#f8f8f2",
    dimText: "#8c8c87",
  },
};

function buildTheme(palette: ThemePalette): Theme {
  if (!terminal.hasColor) {
    return {
      brand: (s) => s,
      dim: (s) => s,
      success: (s) => s,
      warning: (s) => s,
      error: (s) => s,
      bold: (s) => s,
    };
  }
  return {
    brand: (s) => chalk.hex(palette.brand)(s),
    dim: (s) => chalk.hex(palette.dimText)(s),
    success: (s) => chalk.hex(palette.success)(s),
    warning: (s) => chalk.hex(palette.warning)(s),
    error: (s) => chalk.hex(palette.error)(s),
    bold: (s) => chalk.bold(s),
  };
}

export const THEMES: Record<string, Theme> = {
  default: buildTheme(PALETTES.default!),
  dark: buildTheme(PALETTES.dark!),
  light: buildTheme(PALETTES.light!),
  "high-contrast": buildTheme(PALETTES["high-contrast"]!),
  matrix: buildTheme(PALETTES.matrix!),
  ocean: buildTheme(PALETTES.ocean!),
  sunset: buildTheme(PALETTES.sunset!),
  monokai: buildTheme(PALETTES.monokai!),
};

export const THEME_PALETTES: Record<string, ThemePalette> = PALETTES;

let activeThemeName: string | null = null;

function readConfigTheme(): string | null {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as { theme?: unknown };
    if (typeof parsed.theme === "string" && parsed.theme in THEMES) {
      return parsed.theme;
    }
  } catch {
    return null;
  }
  return null;
}

function envTheme(): string | null {
  const envName = process.env.CONSILIUM_THEME;
  if (envName && envName in THEMES) return envName;
  return null;
}

export function getActiveThemeName(): string {
  if (activeThemeName && activeThemeName in THEMES) return activeThemeName;
  const fromEnv = envTheme();
  if (fromEnv) {
    activeThemeName = fromEnv;
    return fromEnv;
  }
  const fromConfig = readConfigTheme();
  if (fromConfig) {
    activeThemeName = fromConfig;
    return fromConfig;
  }
  activeThemeName = "default";
  return "default";
}

export function getActiveTheme(): Theme {
  const name = getActiveThemeName();
  return THEMES[name] ?? THEMES.default!;
}

export function getActivePalette(): ThemePalette {
  const name = getActiveThemeName();
  return PALETTES[name] ?? PALETTES.default!;
}

export function setActiveTheme(name: string): void {
  if (!(name in THEMES)) {
    throw new Error(
      `Unknown theme: ${name}. Available: ${Object.keys(THEMES).join(", ")}`,
    );
  }
  activeThemeName = name;
  persistTheme(name);
}

function persistTheme(name: string): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }
    let current: Record<string, unknown> = {};
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        current = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) as Record<
          string,
          unknown
        >;
      } catch {
        current = {};
      }
    }
    current.theme = name;
    const tmp = `${CONFIG_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(current, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, CONFIG_FILE);
  } catch {
    // best-effort persistence; runtime state still holds
  }
}

export function listThemeNames(): string[] {
  return Object.keys(THEMES);
}

export function _resetForTests(): void {
  activeThemeName = null;
}
