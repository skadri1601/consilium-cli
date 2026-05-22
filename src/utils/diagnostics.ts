import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { DEFAULT_API_ORIGIN, loadConfig } from "./config";
import { KeyManager, PROVIDER_DISPLAY_NAMES } from "./key-manager";
import { checkAllConfiguredKeys } from "./key-validator";
import { isSchedulerRunning } from "./scheduler-daemon";
import { listAgents } from "./agent-registry";

export interface SystemInfo {
  os: string;
  arch: string;
  nodeVersion: string;
  cliVersion: string;
}

export interface ApiHealth {
  url: string;
  reachable: boolean;
  latencyMs?: number;
  error?: string;
}

export interface ProviderKeyStatus {
  provider: string;
  configured: boolean;
  valid?: boolean;
  error?: string;
}

export interface DiagnosticResult {
  system: SystemInfo;
  api: ApiHealth;
  providerKeys: ProviderKeyStatus[];
  schedulerRunning: boolean;
  agentCount: number;
  sessionCount: number;
  freeTier: { available: boolean; note: string };
  diskUsage: {
    configDir: string;
    totalBytes: number;
    sessions: number;
    agents: number;
    generated: number;
  };
}

const HEALTH_TIMEOUT_MS = 4000;

function getCliVersion(): string {
  try {
    const req = createRequire(import.meta.url);
    const pkg = req("../../package.json") as { version?: string };
    if (typeof pkg.version === "string") return pkg.version;
  } catch {
    // fall through
  }
  try {
    const req = createRequire(import.meta.url);
    const pkg = req("../package.json") as { version?: string };
    if (typeof pkg.version === "string") return pkg.version;
  } catch {
    // fall through
  }
  return "unknown";
}

function gatherSystemInfo(): SystemInfo {
  return {
    os: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    nodeVersion: process.version,
    cliVersion: getCliVersion(),
  };
}

async function probeApi(apiUrl: string): Promise<ApiHealth> {
  const url = apiUrl.replace(/\/$/, "");
  const target = `${url}/health`;
  const started = Date.now();
  try {
    const res = await fetch(target, {
      method: "GET",
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - started;
    if (res.ok) {
      return { url, reachable: true, latencyMs };
    }
    return {
      url,
      reachable: false,
      latencyMs,
      error: `HTTP ${res.status}`,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { url, reachable: false, error: reason };
  }
}

async function gatherProviderKeyStatus(): Promise<ProviderKeyStatus[]> {
  const km = new KeyManager();
  const configured = km.getAvailableProviders();
  const out: ProviderKeyStatus[] = [];
  for (const provider of configured) {
    out.push({ provider, configured: true });
  }
  if (configured.length === 0) return out;
  const checks = await checkAllConfiguredKeys();
  for (const check of checks) {
    const entry = out.find((p) => p.provider === check.provider);
    if (entry) {
      entry.valid = check.valid;
      if (check.error) entry.error = check.error;
    }
  }
  return out;
}

function dirByteSize(dir: string): { bytes: number; entries: number } {
  if (!fs.existsSync(dir)) return { bytes: 0, entries: 0 };
  let bytes = 0;
  let entries = 0;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      let names: string[] = [];
      try {
        names = fs.readdirSync(current);
      } catch {
        continue;
      }
      for (const name of names) {
        stack.push(path.join(current, name));
      }
    } else if (stat.isFile()) {
      bytes += stat.size;
      entries += 1;
    }
  }
  return { bytes, entries };
}

function gatherDiskUsage(): DiagnosticResult["diskUsage"] {
  const configDir = path.join(os.homedir(), ".consilium");
  const sessionsDir = path.join(configDir, "sessions");
  const agentsDir = path.join(configDir, "agents");
  const generatedDir = path.join(configDir, "generated");
  const total = dirByteSize(configDir);
  const sessions = dirByteSize(sessionsDir);
  const agents = dirByteSize(agentsDir);
  const generated = dirByteSize(generatedDir);
  return {
    configDir,
    totalBytes: total.bytes,
    sessions: sessions.bytes,
    agents: agents.bytes,
    generated: generated.bytes,
  };
}

function countSessions(): number {
  const sessionDir = path.join(os.homedir(), ".consilium", "sessions");
  if (!fs.existsSync(sessionDir)) return 0;
  try {
    return fs.readdirSync(sessionDir).filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

function detectFreeTier(): { available: boolean; note: string } {
  const groq = process.env["CONSILIUM_FREE_TIER_GROQ_KEY"];
  const openrouter = process.env["CONSILIUM_FREE_TIER_OPENROUTER_KEY"];
  if (groq && groq.length > 0) {
    return { available: true, note: "platform Groq fallback active" };
  }
  if (openrouter && openrouter.length > 0) {
    return { available: true, note: "platform OpenRouter fallback active" };
  }
  return {
    available: false,
    note: "no local free-tier env keys (platform may still supply)",
  };
}

export async function runDiagnostics(): Promise<DiagnosticResult> {
  const config = loadConfig();
  const apiUrl = (config.apiUrl || DEFAULT_API_ORIGIN).replace(/\/$/, "");
  const [api, providerKeys] = await Promise.all([
    probeApi(apiUrl),
    gatherProviderKeyStatus(),
  ]);
  return {
    system: gatherSystemInfo(),
    api,
    providerKeys,
    schedulerRunning: isSchedulerRunning(),
    agentCount: listAgents().length,
    sessionCount: countSessions(),
    freeTier: detectFreeTier(),
    diskUsage: gatherDiskUsage(),
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function renderDiagnostics(result: DiagnosticResult): string {
  const lines: string[] = [];
  lines.push("Consilium CLI doctor");
  lines.push("");
  lines.push("System");
  lines.push(`  OS:           ${result.system.os} (${result.system.arch})`);
  lines.push(`  Node:         ${result.system.nodeVersion}`);
  lines.push(`  CLI version:  ${result.system.cliVersion}`);
  lines.push("");
  lines.push("API");
  lines.push(`  URL:          ${result.api.url}`);
  if (result.api.reachable) {
    const ms = result.api.latencyMs ?? 0;
    lines.push(`  Reachable:    yes (${ms} ms)`);
  } else {
    lines.push(
      `  Reachable:    no${result.api.error ? ` (${result.api.error})` : ""}`,
    );
  }
  lines.push("");
  lines.push("Free tier");
  lines.push(
    `  Status:       ${result.freeTier.available ? "active" : "inactive"}`,
  );
  lines.push(`  Note:         ${result.freeTier.note}`);
  lines.push("");
  lines.push("Provider keys");
  if (result.providerKeys.length === 0) {
    lines.push("  (none configured)");
  } else {
    for (const k of result.providerKeys) {
      const label =
        (PROVIDER_DISPLAY_NAMES as Record<string, string | undefined>)[
          k.provider
        ] ?? k.provider;
      const mark =
        k.valid === true ? "valid" : k.valid === false ? "invalid" : "unknown";
      const detail = k.error ? ` - ${k.error}` : "";
      lines.push(`  ${label.padEnd(16)} configured  ${mark}${detail}`);
    }
  }
  lines.push("");
  lines.push("Autonomy");
  lines.push(
    `  Scheduler:    ${result.schedulerRunning ? "running" : "stopped"}`,
  );
  lines.push(`  Background agents: ${result.agentCount}`);
  lines.push("");
  lines.push("Storage");
  lines.push(`  Config dir:   ${result.diskUsage.configDir}`);
  lines.push(
    `  Sessions:     ${result.sessionCount} (${formatBytes(result.diskUsage.sessions)})`,
  );
  lines.push(`  Agents data:  ${formatBytes(result.diskUsage.agents)}`);
  lines.push(`  Generated:    ${formatBytes(result.diskUsage.generated)}`);
  lines.push(`  Total:        ${formatBytes(result.diskUsage.totalBytes)}`);
  return lines.join("\n");
}
