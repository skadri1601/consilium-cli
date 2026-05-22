import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isPlanModeActive } from "./plan-mode";
import { evaluate, loadRulesFromConfig } from "./permission-grammar";

const CONFIG_DIR = path.join(os.homedir(), ".consilium");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const ENV_KEY = "CONSILIUM_PERMISSION_MODE";
const BYPASS_ENV_KEY = "CONSILIUM_ALLOW_BYPASS";

export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "auto"
  | "plan"
  | "bypass";

export const MODE_ORDER: PermissionMode[] = [
  "default",
  "acceptEdits",
  "auto",
  "plan",
  "bypass",
];

const VALID_MODES = new Set<PermissionMode>(MODE_ORDER);

function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === "string" && VALID_MODES.has(value as PermissionMode);
}

function readPersistedMode(): PermissionMode | null {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const candidate = parsed.permissionMode;
    return isPermissionMode(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function persistMode(mode: PermissionMode): void {
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
    current.permissionMode = mode;
    const tmp = `${CONFIG_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(current, null, 2), { mode: 0o600 });
    try {
      fs.chmodSync(tmp, 0o600);
    } catch {
      // best-effort
    }
    fs.renameSync(tmp, CONFIG_FILE);
  } catch {
    // best-effort; mode still applied via env for current process
  }
}

export function getCurrentMode(): PermissionMode {
  const envValue = process.env[ENV_KEY];
  if (isPermissionMode(envValue)) return envValue;
  const persisted = readPersistedMode();
  if (persisted) return persisted;
  return "default";
}

export function setMode(mode: PermissionMode): void {
  if (!isPermissionMode(mode)) {
    throw new Error(
      `Invalid permission mode: ${mode}. Valid: ${MODE_ORDER.join(", ")}.`,
    );
  }
  process.env[ENV_KEY] = mode;
  persistMode(mode);
}

function isBypassAllowed(): boolean {
  const flag = process.env[BYPASS_ENV_KEY];
  return flag === "1" || flag === "true";
}

export function cycleMode(): PermissionMode {
  const current = getCurrentMode();
  const idx = MODE_ORDER.indexOf(current);
  let nextIdx = idx >= 0 ? (idx + 1) % MODE_ORDER.length : 0;
  let next = MODE_ORDER[nextIdx]!;
  if (next === "bypass" && !isBypassAllowed()) {
    nextIdx = (nextIdx + 1) % MODE_ORDER.length;
    next = MODE_ORDER[nextIdx]!;
  }
  setMode(next);
  return next;
}

export function describeMode(mode: PermissionMode): string {
  switch (mode) {
    case "default":
      return "default - prompt on every write";
    case "acceptEdits":
      return "acceptEdits - auto-approve writes inside the current working directory";
    case "auto":
      return "auto - allow when matched by rules, otherwise prompt";
    case "plan":
      return "plan - block all writes (planning only)";
    case "bypass":
      return "bypass - allow every write (DANGEROUS; requires CONSILIUM_ALLOW_BYPASS=1)";
  }
}

function isInsideCwd(scope: string): boolean {
  if (!scope) return false;
  try {
    const cwd = path.resolve(process.cwd());
    const candidate = path.resolve(scope);
    if (candidate === cwd) return true;
    return candidate.startsWith(cwd + path.sep);
  } catch {
    return false;
  }
}

function planModeDenies(): boolean {
  try {
    if (isPlanModeActive()) return true;
  } catch {
    // fall through to env check
  }
  const envFlag = process.env.CONSILIUM_PLAN_MODE;
  return envFlag === "1" || envFlag === "true";
}

export function modeAllowsWrite(
  mode: PermissionMode,
  scope: string,
): "allow" | "ask" | "deny" {
  if (mode === "plan") {
    return "deny";
  }
  if (planModeDenies()) {
    return "deny";
  }
  if (mode === "bypass") {
    return isBypassAllowed() ? "allow" : "ask";
  }
  if (mode === "acceptEdits") {
    return isInsideCwd(scope) ? "allow" : "ask";
  }
  if (mode === "auto") {
    const rules = loadRulesFromConfig();
    return evaluate({ tool: "Write", target: scope }, rules);
  }
  return "ask";
}

export function _resetPermissionModeForTests(): void {
  delete process.env[ENV_KEY];
  delete process.env[BYPASS_ENV_KEY];
  delete process.env.CONSILIUM_PLAN_MODE;
}
