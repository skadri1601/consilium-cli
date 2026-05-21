import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CONFIG_DIR = path.join(os.homedir(), ".consilium");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export const DEFAULT_API_ORIGIN = "https://api.myconsilium.xyz";
export const DEFAULT_WEB_ORIGIN = "https://myconsilium.xyz";

export interface UserPreferences {
  defaultAgents: string[];
  defaultMode: string;
}

export interface Config {
  apiUrl?: string;
  apiKey?: string;
  webUrl?: string;
  debug?: boolean;
  userName?: string;
  userEmail?: string;
  preferences?: UserPreferences;
}

function assertHttpsOrLocal(rawUrl: string, envVar: string): string {
  try {
    const parsed = new URL(rawUrl);
    const isLoopback =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1";
    if (parsed.protocol !== "https:" && !isLoopback) {
      throw new Error(
        `${envVar} must be HTTPS (got ${parsed.protocol}). Set a secure URL or use localhost for local dev.`,
      );
    }
    return parsed.toString().replace(/\/$/, "");
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error(`${envVar} is not a valid URL: ${rawUrl}`);
    }
    throw err;
  }
}

function defaultConfigFromEnv(): Config {
  const apiUrl = process.env.CONSILIUM_API_URL
    ? assertHttpsOrLocal(process.env.CONSILIUM_API_URL, "CONSILIUM_API_URL")
    : DEFAULT_API_ORIGIN;
  const webUrl = process.env.CONSILIUM_WEB_URL
    ? assertHttpsOrLocal(process.env.CONSILIUM_WEB_URL, "CONSILIUM_WEB_URL")
    : DEFAULT_WEB_ORIGIN;
  return {
    apiUrl,
    webUrl,
    debug:
      process.env.CONSILIUM_DEBUG === "1" ||
      process.env.CONSILIUM_DEBUG === "true",
  };
}

export function loadConfig(): Config {
  const defaults = defaultConfigFromEnv();
  if (!fs.existsSync(CONFIG_FILE)) {
    return { ...defaults };
  }

  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<Config>;
    return { ...defaults, ...parsed };
  } catch (error) {
    console.error("Failed to load config:", error);
    return { ...defaults };
  }
}

/**
 * Write `data` to `target` atomically: write to a sibling .tmp file
 * then rename it over `target`. Two concurrent CLI invocations doing
 * read-modify-write through saveConfig() previously could clobber
 * each other; with atomic rename the loser's write fails cleanly
 * instead of producing a corrupt half-merged JSON.
 */
function atomicWrite(target: string, data: string, mode: number): void {
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode });
  try {
    fs.chmodSync(tmp, mode);
  } catch {
    // best-effort
  }
  fs.renameSync(tmp, target);
}

export function saveConfig(config: Config): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  } else {
    try {
      fs.chmodSync(CONFIG_DIR, 0o700);
    } catch {
      // best-effort; ignore on platforms where chmod is unsupported
    }
  }

  atomicWrite(CONFIG_FILE, JSON.stringify(config, null, 2), 0o600);
}

// Keys the `consilium config set` CLI is allowed to mutate.
// Anything outside this list (e.g. internal "providerKeys" / "userEmail")
// is treated as a typo and rejected, so users can't accidentally
// corrupt the config file schema with arbitrary keys.
const SETTABLE_CONFIG_KEYS = [
  "apiUrl",
  "apiKey",
  "webUrl",
  "debug",
] as const satisfies readonly (keyof Config)[];

type SettableConfigKey = (typeof SETTABLE_CONFIG_KEYS)[number];

function isSettableKey(key: string): key is SettableConfigKey {
  return (SETTABLE_CONFIG_KEYS as readonly string[]).includes(key);
}

export function updateConfig(key: string, value: string): void {
  if (!isSettableKey(key)) {
    throw new Error(
      `Unknown config key: ${key}. Valid keys: ${SETTABLE_CONFIG_KEYS.join(", ")}.`,
    );
  }
  const config = loadConfig();
  if (key === "debug") {
    config.debug = value === "true" || value === "1";
  } else {
    config[key] = value;
  }
  saveConfig(config);
}

export function getConfigValue(key: string): string | undefined {
  const config = loadConfig();
  return (config as Record<string, unknown>)[key] as string | undefined;
}

export function listConfig(): Config {
  return loadConfig();
}

export function isLoggedIn(): boolean {
  const config = loadConfig();
  return !!config.apiKey && config.apiKey.startsWith("consilium_");
}

export function clearAuth(): void {
  const config = loadConfig();
  delete config.apiKey;
  delete config.userName;
  delete config.userEmail;
  delete config.preferences;
  saveConfig(config);
}

export async function fetchAndCachePreferences(): Promise<UserPreferences | null> {
  const config = loadConfig();
  if (!config.apiKey) return null;
  const apiUrl = (config.apiUrl ?? DEFAULT_API_ORIGIN).replace(/\/$/, "");
  try {
    const res = await fetch(`${apiUrl}/api/v1/users/me/preferences`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const prefs = (await res.json()) as UserPreferences;
    if (Array.isArray(prefs.defaultAgents) && prefs.defaultMode) {
      saveConfig({ ...loadConfig(), preferences: prefs });
      return prefs;
    }
    return null;
  } catch {
    return null;
  }
}

export function getCachedPreferences(): UserPreferences | null {
  const config = loadConfig();
  if (
    config.preferences &&
    Array.isArray(config.preferences.defaultAgents) &&
    config.preferences.defaultAgents.length > 0
  ) {
    return config.preferences;
  }
  return null;
}

export async function getPreferences(): Promise<UserPreferences> {
  const cached = getCachedPreferences();
  if (cached) return cached;
  const fetched = await fetchAndCachePreferences();
  if (fetched) return fetched;
  return { defaultAgents: [], defaultMode: "auto" };
}
