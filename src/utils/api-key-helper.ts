import { exec } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig } from "./config";

const execAsync = promisify(exec);

export interface ApiKeyHelperConfig {
  command: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
}

export interface ApiKeyHelperMap {
  [provider: string]: ApiKeyHelperConfig | undefined;
}

interface CacheEntry {
  value: string;
  expiresAt: number;
}

type ExecRunner = (
  command: string,
  options: { timeout: number; maxBuffer: number },
) => Promise<{ stdout: string; stderr: string }>;

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

const cache = new Map<string, CacheEntry>();
let execRunner: ExecRunner = execAsync as unknown as ExecRunner;
let configLoader: () => Record<string, unknown> = () =>
  loadConfig() as unknown as Record<string, unknown>;
let nowFn: () => number = () => Date.now();

export function __setApiKeyHelperDepsForTests(deps: {
  exec?: ExecRunner;
  loadConfig?: () => Record<string, unknown>;
  now?: () => number;
}): void {
  if (deps.exec) execRunner = deps.exec;
  if (deps.loadConfig) configLoader = deps.loadConfig;
  if (deps.now) nowFn = deps.now;
}

export function __resetApiKeyHelperDepsForTests(): void {
  execRunner = execAsync as unknown as ExecRunner;
  configLoader = () => loadConfig() as unknown as Record<string, unknown>;
  nowFn = () => Date.now();
  cache.clear();
}

export function clearApiKeyHelperCache(provider?: string): void {
  if (provider) cache.delete(provider);
  else cache.clear();
}

function getHelperConfig(provider: string): ApiKeyHelperConfig | null {
  const config = configLoader();
  const helpers = config["apiKeyHelper"];
  if (!helpers || typeof helpers !== "object") return null;
  const entry = (helpers as ApiKeyHelperMap)[provider];
  if (!entry || typeof entry !== "object") return null;
  if (typeof entry.command !== "string" || entry.command.trim() === "") {
    return null;
  }
  return entry;
}

export async function resolveApiKey(provider: string): Promise<string | null> {
  const cfg = getHelperConfig(provider);
  if (!cfg) return null;

  const now = nowFn();
  const cached = cache.get(provider);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const timeout = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ttl = cfg.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;

  try {
    const { stdout } = await execRunner(cfg.command, {
      timeout,
      maxBuffer: 1024 * 1024,
    });
    const value = stdout.trim();
    if (!value) return null;
    cache.set(provider, { value, expiresAt: now + ttl });
    return value;
  } catch {
    return null;
  }
}
