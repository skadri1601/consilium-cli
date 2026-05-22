import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { getCachedPreferences, loadConfig } from "./config.js";
import { DEFAULT_MODELS } from "./default-models.js";

const execAsync = promisify(exec);

export interface StatusLineContext {
  cwd: string;
  branch?: string;
  model?: string;
  sessionId?: string;
  tokensUsed?: number;
  costUsd?: number;
  mode?: string;
}

export const DEFAULT_STATUS_LINE_TEMPLATE =
  " {cwd}  {branch}  {model}  ${cost} ";

const PLACEHOLDER_RE = /\{(cwd|branch|model|sessionId|tokens|cost|mode)\}/g;

function formatCost(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "?";
  if (value === 0) return "0.00";
  if (value < 0.01) return value.toFixed(4);
  return value.toFixed(2);
}

function formatTokens(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "?";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function shortenCwd(cwd: string): string {
  const home = os.homedir();
  if (cwd === home) return "~";
  if (cwd.startsWith(home + path.sep)) {
    return "~" + cwd.slice(home.length);
  }
  return cwd;
}

export function renderStatusLine(
  ctx: StatusLineContext,
  template?: string,
): string {
  const tpl =
    template ?? loadTemplateFromConfig() ?? DEFAULT_STATUS_LINE_TEMPLATE;

  return tpl.replace(PLACEHOLDER_RE, (_, key: string) => {
    switch (key) {
      case "cwd":
        return shortenCwd(ctx.cwd) || "?";
      case "branch":
        return ctx.branch && ctx.branch.length > 0 ? ctx.branch : "?";
      case "model":
        return ctx.model && ctx.model.length > 0 ? ctx.model : "?";
      case "sessionId":
        return ctx.sessionId && ctx.sessionId.length > 0 ? ctx.sessionId : "?";
      case "tokens":
        return formatTokens(ctx.tokensUsed);
      case "cost":
        return formatCost(ctx.costUsd);
      case "mode":
        return ctx.mode && ctx.mode.length > 0 ? ctx.mode : "?";
      default:
        return "?";
    }
  });
}

function loadTemplateFromConfig(): string | undefined {
  try {
    const configPath = path.join(os.homedir(), ".consilium", "config.json");
    if (!fs.existsSync(configPath)) return undefined;
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as { statusLineTemplate?: string };
    if (
      typeof parsed.statusLineTemplate === "string" &&
      parsed.statusLineTemplate.length > 0
    ) {
      return parsed.statusLineTemplate;
    }
  } catch {
    // Ignore malformed config; fall back to default.
  }
  return undefined;
}

async function getGitBranch(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync("git branch --show-current", {
      cwd,
      timeout: 1500,
    });
    const branch = stdout.trim();
    return branch.length > 0 ? branch : undefined;
  } catch {
    return undefined;
  }
}

function resolveDefaultModel(): string | undefined {
  const prefs = getCachedPreferences();
  if (prefs && prefs.defaultAgents.length > 0) {
    return prefs.defaultAgents[0];
  }
  return DEFAULT_MODELS[0];
}

export async function getCurrentContext(): Promise<StatusLineContext> {
  const cwd = process.cwd();
  const [branch] = await Promise.all([getGitBranch(cwd)]);
  const config = loadConfig();
  const model = resolveDefaultModel();
  return {
    cwd,
    branch,
    model,
    mode: config.preferences?.defaultMode,
  };
}
