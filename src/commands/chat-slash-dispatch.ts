import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Interface as ReadlineInterface } from "node:readline";
import type { ChatSession } from "./chat-session";
import { SessionManager } from "../utils/session-manager";
import {
  clearGoal,
  getGoalForSession,
  listLoopsForSession,
  listSchedulesForSession,
  persistGoal,
  persistLoop,
  persistSchedule,
  removeLoop,
  removeSchedule,
  updateLoopLastRun,
  updateScheduleNextRun,
  type LoopRegistration,
  type ScheduleRegistration,
} from "../utils/autonomy-store";

type LoopHandle = {
  id: string;
  intervalMs: number;
  prompt: string;
  timer: NodeJS.Timeout;
};

type ScheduleHandle = {
  id: string;
  prompt: string;
  spec: string;
  intervalMs: number;
  timer: NodeJS.Timeout;
};

interface SessionExtras {
  goal?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
  loops: Map<string, LoopHandle>;
  schedules: Map<string, ScheduleHandle>;
  customCommandsLoaded: boolean;
  customCommands: Map<string, CustomCommandLike>;
  activeDebateId?: string;
}

interface CustomCommandLike {
  name: string;
  filePath: string;
  template: string;
  description?: string;
}

const sessionExtras = new Map<string, SessionExtras>();

function getExtras(session: ChatSession): SessionExtras {
  const key = session.id ?? "__pending__";
  let extras = sessionExtras.get(key);
  if (!extras) {
    extras = {
      loops: new Map(),
      schedules: new Map(),
      customCommandsLoaded: false,
      customCommands: new Map(),
    };
    sessionExtras.set(key, extras);
  }
  return extras;
}

export function getSessionExtras(
  session: ChatSession,
): Readonly<SessionExtras> {
  return getExtras(session);
}

export function setActiveDebateId(
  session: ChatSession,
  debateId: string,
): void {
  getExtras(session).activeDebateId = debateId;
}

export function clearActiveDebateId(session: ChatSession): void {
  getExtras(session).activeDebateId = undefined;
}

function parseDurationToMs(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed === "daily") return 24 * 60 * 60 * 1000;
  if (trimmed === "hourly") return 60 * 60 * 1000;
  const m = trimmed.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = m[2] ?? "m";
  const multiplier =
    unit === "ms"
      ? 1
      : unit === "s"
        ? 1000
        : unit === "m"
          ? 60 * 1000
          : unit === "h"
            ? 60 * 60 * 1000
            : unit === "d"
              ? 24 * 60 * 60 * 1000
              : 60 * 1000;
  return Math.round(value * multiplier);
}

function makeLocalId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

function formatDurationMs(ms: number): string {
  if (ms % (24 * 60 * 60 * 1000) === 0) return `${ms / (24 * 60 * 60 * 1000)}d`;
  if (ms % (60 * 60 * 1000) === 0) return `${ms / (60 * 60 * 1000)}h`;
  if (ms % (60 * 1000) === 0) return `${ms / (60 * 1000)}m`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}
import {
  DEFAULT_API_ORIGIN,
  DEFAULT_WEB_ORIGIN,
  loadConfig,
  updateConfig,
} from "../utils/config";
import { openBrowser } from "../utils/open-browser";
import {
  consumeWritePermission,
  getPermissionSnapshot,
  hasCodebasePermission,
  requestCodebasePermission,
  requestWritePermission,
  revokeCodebasePermission,
  revokeWritePermission,
} from "../utils/codebase-permissions";
import {
  userHasStoredProviderKeys,
  type MaskedProviderKeys,
} from "../utils/post-login-onboarding";
import { applyEdits, parseEditsFromSynthesis } from "../utils/apply-edits";
import { formatEditPreview } from "../utils/diff-preview";
import { resolveProjectRoot } from "../utils/project-root";
import {
  restoreRollbackSnapshot,
  type RollbackSnapshot,
} from "../utils/rollback";
import { getGitDiff, getCurrentBranch } from "../utils/git-context";
import { navigateDiffs, parseUnifiedDiff } from "../utils/diff-navigator";
import readline from "node:readline";
import { style } from "../utils/visual-system";
import { getTUI } from "../utils/tui-renderer";
import {
  handleConversationsCommand,
  handleContextCommand,
  handleModeCommand,
  handleEstimateCommand,
  handleOutputCommand,
  handleWorkspaceCommand,
} from "../utils/chat-commands";
import { log } from "../utils/logger";
import { runDiagnostics, renderDiagnostics } from "../utils/diagnostics";
import { checkAllConfiguredKeys } from "../utils/key-validator";
import {
  KeyManager,
  PROVIDER_DISPLAY_NAMES,
  type Provider,
} from "../utils/key-manager";

const st = style();

export type SlashResult = "exit" | "continue" | "delete-pending";

export interface SlashDelegates {
  printHelp: () => void;
  printConversationHistory: (session: ChatSession) => void;
  handleSearchCommand: (query: string, sm: SessionManager) => void;
  handleSessionsListCommand: (sm: SessionManager) => void;
  handleRenameCommand: (
    args: string[],
    session: ChatSession,
    sm: SessionManager,
  ) => void;
  rerunLastDebateWithWorkspace?: () => Promise<void>;
}

function slashExit(
  sessionManager: SessionManager,
  session: ChatSession,
): SlashResult {
  const sessionId = sessionManager.saveSession(session);
  log("INFO", "session_saved", { sessionId });
  console.log(
    st.success("\nSession saved. Resume with:"),
    st.brand(`consilium sessions resume ${sessionId}\n`),
  );
  return "exit";
}

function slashFile(args: string[], session: ChatSession): SlashResult {
  const filePath = args[0];
  if (!filePath) {
    console.log(st.warning("Usage: /file <path>"));
    return "continue";
  }
  try {
    session.contextManager.addFile(filePath);
    session.contextFilePaths.push(filePath);
    const files = session.contextManager.getFiles();
    const entry = files.find((f) => f.name === path.basename(filePath));
    const sizeKb = entry ? (entry.size / 1024).toFixed(1) : "?";
    console.log(
      st.success(`Added ${path.basename(filePath)} to context (${sizeKb} KB)`),
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(st.error("Error:"), msg);
  }
  return "continue";
}

function slashImage(args: string[], session: ChatSession): SlashResult {
  const imagePath = args[0];
  if (!imagePath) {
    console.log(st.warning("Usage: /image <path>"));
    return "continue";
  }
  try {
    session.contextManager.addImage(imagePath);
    session.contextImagePaths.push(imagePath);
    console.log(st.success(`Added ${path.basename(imagePath)} to context`));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(st.error("Error:"), msg);
  }
  return "continue";
}

function slashClear(session: ChatSession): SlashResult {
  session.contextManager.clear();
  session.contextFilePaths = [];
  session.contextImagePaths = [];
  console.log(st.success("Context cleared."));
  return "continue";
}

function slashStatus(session: ChatSession): SlashResult {
  const files = session.contextManager.getFiles();
  const totalSize = session.contextManager.getTotalSize();
  console.log(st.bold("\nSession Status\n"));
  if (session.name) console.log(st.brand("Name:"), session.name);
  if (session.id) console.log(st.brand("ID:"), session.id);
  console.log(st.brand("Models:"), session.models.join(", "));
  console.log(st.brand("Context files:"), files.length);
  if (files.length > 0) {
    files.forEach((f) =>
      console.log(st.dim(`  - ${f.name} (${f.size} bytes)`)),
    );
    console.log(st.brand("Total context size:"), `${totalSize} bytes`);
  }
  console.log(st.brand("Debates in session:"), session.debates.length);
  if (session.contextManifest) {
    console.log(
      st.brand("Scanned context:"),
      `${session.contextManifest.loaded} files (${(session.contextManifest.loadedBytes / 1024).toFixed(1)} KB)`,
    );
  }
  if (session.lastGoldenPrompt) {
    const preview =
      session.lastGoldenPrompt.length > 50
        ? session.lastGoldenPrompt.substring(0, 50) + "..."
        : session.lastGoldenPrompt;
    console.log(st.brand("Last synthesis:"), preview);
  }
  console.log("");
  return "continue";
}

function slashManifest(session: ChatSession): SlashResult {
  const manifest = session.contextManifest;
  if (!manifest) {
    console.log(st.dim("\nNo workspace scan manifest available yet.\n"));
    return "continue";
  }
  console.log(st.bold("\nContext manifest\n"));
  console.log(st.brand("Root:"), manifest.root);
  console.log(st.brand("Loaded:"), `${manifest.loaded} files`);
  console.log(st.brand("Loaded bytes:"), `${manifest.loadedBytes} bytes`);
  console.log(
    st.brand("Skipped:"),
    `secret=${manifest.skipped.secret}, binary=${manifest.skipped.binary}, payload-limit=${manifest.skipped["payload-limit"]}, skip-rule=${manifest.skipped["skip-rule"]}, read-error=${manifest.skipped["read-error"]}, max-files=${manifest.skipped["max-files"]}`,
  );
  console.log("");
  return "continue";
}

function slashModels(args: string[], session: ChatSession): SlashResult {
  if (args.length > 0) {
    session.models = args;
    console.log(st.success("Models set:"), session.models.join(", "));
  } else {
    console.log(st.brand("Current models:"), session.models.join(", "));
  }
  return "continue";
}

async function slashSave(
  args: string[],
  session: ChatSession,
  sessionManager: SessionManager,
): Promise<SlashResult> {
  const filepath = args[0];
  if (filepath) {
    if (session.lastGoldenPrompt) {
      try {
        const rootInfo = resolveProjectRoot(process.cwd());
        const level = await requestWritePermission(rootInfo.root);
        if (level === "deny" || !consumeWritePermission(rootInfo.root)) {
          console.log(
            st.warning(
              "Write permission denied. Use /permissions status to review policy.",
            ),
          );
          return "continue";
        }
        fs.writeFileSync(filepath, session.lastGoldenPrompt, "utf-8");
        console.log(st.success(`Saved synthesis to ${filepath}`));
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(st.error("Failed to save synthesis file:"), msg);
        console.error(st.dim(`Path: ${filepath}`));
      }
    } else {
      console.log(st.warning("No synthesis to save. Run a debate first."));
    }
  } else {
    const sessionId = sessionManager.saveSession(session);
    log("INFO", "session_saved", { sessionId });
    console.log(
      st.success("Session saved. Resume with:"),
      st.brand(`consilium sessions resume ${sessionId}`),
    );
  }
  return "continue";
}

function slashApi(args: string[]): SlashResult {
  const sub = args[0]?.toLowerCase();
  const config = loadConfig();
  const webUrl =
    config.webUrl || process.env.CONSILIUM_WEB_URL || DEFAULT_WEB_ORIGIN;
  const settingsCliUrl = `${webUrl}/settings#cli`;

  if (sub === "set") {
    const key = args.slice(1).join(" ").trim() || (args[1] ?? "");
    if (!key) {
      console.log(st.warning("Usage: /api set <your-api-key>"));
      console.log(
        st.dim(
          "Get a key from the web app: Settings > CLI > Generate CLI token",
        ),
      );
      console.log(st.dim("Or run: /api open"));
      return "continue";
    }
    updateConfig("apiKey", key);
    console.log(st.success("API key saved. You can run debates now."));
    return "continue";
  }

  if (sub === "open") {
    console.log(st.brand("Opening web app to sign in and get CLI token..."));
    openBrowser(settingsCliUrl);
    console.log(st.success("Opened:"), settingsCliUrl);
    return "continue";
  }

  const apiKey = config.apiKey?.trim();
  console.log(st.bold("\nAPI Configuration\n"));
  console.log(st.brand("API URL:"), config.apiUrl || DEFAULT_API_ORIGIN);
  if (apiKey) {
    const masked =
      apiKey.length > 12
        ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`
        : "***";
    console.log(st.brand("API key:"), st.success("set"), st.dim(`(${masked})`));
  } else {
    console.log(st.brand("API key:"), st.warning("not set"));
    console.log(st.dim("  Set key: /api set <key>"));
    console.log(st.dim("  Get key: /api open (opens web app)"));
  }
  console.log("");
  return "continue";
}

function slashMode(args: string[], session: ChatSession): SlashResult {
  const result = handleModeCommand(args, session.mode);
  if (result.changed) {
    session.mode = result.mode as ChatSession["mode"];
  }
  return "continue";
}

function slashOutput(args: string[], session: ChatSession): SlashResult {
  const result = handleOutputCommand(args, session.outputFormat);
  if (result.changed) {
    session.outputFormat = result.format as ChatSession["outputFormat"];
  }
  return "continue";
}

async function slashInsights(): Promise<SlashResult> {
  console.log(st.dim("Analyzing sessions..."));
  const { analyzeSessions, renderInsights } =
    await import("../utils/session-analytics.js");
  try {
    const insights = await analyzeSessions({ sinceDays: 30 });
    console.log(renderInsights(insights));
    console.log("");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(st.error(`Insight analysis failed: ${msg}`));
  }
  return "continue";
}

function expandHome(target: string): string {
  if (target.startsWith("~")) return path.join(os.homedir(), target.slice(1));
  return target;
}

async function slashTeamOnboarding(args: string[]): Promise<SlashResult> {
  const target = args[0] || "~/.consilium/onboarding-guide.md";
  console.log(st.dim("Generating onboarding guide..."));
  const { analyzeSessions, renderOnboardingGuide } =
    await import("../utils/session-analytics.js");
  try {
    const insights = await analyzeSessions({ sinceDays: 30 });
    const guide = renderOnboardingGuide(insights);
    const outPath = expandHome(target);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, guide, "utf-8");
    console.log(st.success(`Onboarding guide saved to ${outPath}`));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(st.error(`Onboarding generation failed: ${msg}`));
  }
  return "continue";
}

async function slashMemory(): Promise<SlashResult> {
  const { loadMemory, renderMemoryForPrompt } =
    await import("../utils/auto-memory.js");
  const mem = loadMemory();
  if (!mem) {
    console.log(st.dim("No memory notes yet for this project."));
    return "continue";
  }
  console.log(renderMemoryForPrompt(mem));
  console.log("");
  return "continue";
}

async function slashKeys(args: string[]): Promise<SlashResult> {
  const config = loadConfig();
  const webUrl =
    config.webUrl || process.env.CONSILIUM_WEB_URL || DEFAULT_WEB_ORIGIN;
  const keysUrl = `${webUrl.replace(/\/$/, "")}/settings#api-keys`;
  const sub = args[0]?.toLowerCase() ?? "open";

  if (sub === "open") {
    console.log(st.brand("Opening provider API keys in browser..."));
    openBrowser(keysUrl);
    console.log(st.success("Opened:"), keysUrl);
    console.log("");
    return "continue";
  }

  if (sub === "status") {
    const token = config.apiKey?.trim();
    const apiBase = (config.apiUrl || DEFAULT_API_ORIGIN).replace(/\/$/, "");
    if (!token) {
      console.log(
        st.warning("No CLI token. Run /api open or consilium login.\n"),
      );
      return "continue";
    }
    try {
      const res = await fetch(`${apiBase}/api/v1/api-keys`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        console.log(st.error(`Could not load key status (${res.status}).\n`));
        return "continue";
      }
      const keys = (await res.json()) as MaskedProviderKeys;
      const has = userHasStoredProviderKeys(keys);
      console.log(st.bold("\nProvider keys (account)\n"));
      if (has) {
        console.log(
          st.success("At least one provider key is saved."),
          st.dim("Manage at"),
        );
        console.log(st.brand(keysUrl));
      } else {
        console.log(
          st.warning("No provider keys saved."),
          st.dim("Debates can use platform Groq where supported."),
        );
        console.log(st.dim("Add keys:"), st.brand(keysUrl));
      }
      await printLocalKeyHealth();
      console.log("");
    } catch {
      console.log(st.error("Could not reach API for key status.\n"));
      await printLocalKeyHealth();
    }
    return "continue";
  }

  console.log(st.dim("Usage: /keys [open|status]"));
  console.log("");
  return "continue";
}

async function printLocalKeyHealth(): Promise<void> {
  const km = new KeyManager();
  const configured = km.getAvailableProviders();
  if (configured.length === 0) {
    console.log(
      st.dim("\nLocal provider keys: none in env or ~/.consilium/config.json"),
    );
    return;
  }
  console.log(st.bold("\nLocal provider keys (live health)"));
  let results: Awaited<ReturnType<typeof checkAllConfiguredKeys>> = [];
  try {
    results = await checkAllConfiguredKeys();
  } catch {
    results = [];
  }
  const byProvider = new Map(results.map((r) => [r.provider, r] as const));
  for (const provider of configured) {
    const label =
      (PROVIDER_DISPLAY_NAMES as Record<string, string | undefined>)[
        provider
      ] ?? provider;
    const result = byProvider.get(provider as Provider);
    if (!result) {
      console.log(`  ${label.padEnd(16)} ${st.dim("? unknown")}`);
      continue;
    }
    if (result.valid) {
      const count =
        typeof result.modelCount === "number"
          ? ` (${result.modelCount} models)`
          : "";
      console.log(
        `  ${label.padEnd(16)} ${st.success("✓ valid")}${st.dim(count)}`,
      );
    } else {
      const reason = result.error ? st.dim(` - ${result.error}`) : "";
      console.log(`  ${label.padEnd(16)} ${st.error("✗ invalid")}${reason}`);
    }
  }
}

function slashRecap(session: ChatSession): SlashResult {
  const debates = (session.debates || []).filter((d) => d?.topic);
  if (debates.length === 0) {
    console.log(st.dim("\nNo debates in this session yet.\n"));
    return "continue";
  }
  const lastFive = debates.slice(-5);
  const parts: string[] = [];
  for (let i = 0; i < lastFive.length; i++) {
    const d = lastFive[i];
    if (!d) continue;
    const synthesis = d.goldenPrompt?.trim() ?? "";
    const snippet =
      synthesis.length > 0
        ? synthesis.length > 140
          ? `${synthesis.slice(0, 137)}...`
          : synthesis
        : "(no synthesis yet)";
    parts.push(`(${i + 1}) "${d.topic}" - ${snippet}`);
  }
  const sessionLabel = session.name || session.id || "current session";
  const totalNote =
    debates.length > lastFive.length
      ? ` Earlier turns omitted (showing last ${lastFive.length} of ${debates.length}).`
      : "";
  const paragraph = `Recap of ${sessionLabel}: across ${debates.length} debate(s), the most recent turns covered: ${parts.join(" ")}.${totalNote}`;
  console.log(st.bold("\nSession recap\n"));
  console.log(paragraph);
  console.log("");
  return "continue";
}

async function slashStop(session: ChatSession): Promise<SlashResult> {
  const extras = getExtras(session);
  const debateId = extras.activeDebateId;
  if (!debateId) {
    console.log(st.dim("\nNo active debate to stop.\n"));
    return "continue";
  }
  try {
    await session.client.cancelDebate(debateId);
    extras.activeDebateId = undefined;
    console.log(
      st.success(`\nRequested cancel for debate ${debateId}.`),
      st.dim(" The stream will emit debate:cancelled when the worker acks.\n"),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(st.error(`\nCould not cancel debate ${debateId}: ${msg}\n`));
  }
  return "continue";
}

async function slashDoctor(): Promise<SlashResult> {
  console.log(st.dim("\nRunning diagnostics..."));
  try {
    const result = await runDiagnostics();
    console.log("");
    console.log(renderDiagnostics(result));
    console.log("");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(st.error(`\nDiagnostics failed: ${msg}\n`));
  }
  return "continue";
}

function slashHeapdump(): SlashResult {
  const dir = path.join(
    process.env.HOME || process.env.USERPROFILE || "",
    ".consilium",
    "diagnostics",
  );
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(st.error(`\nCould not create ${dir}: ${msg}\n`));
    return "continue";
  }
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(dir, `heap-${ts}.json`);
  const report = (
    process as unknown as {
      report?: {
        writeReport?: (filename?: string) => string | undefined;
      };
    }
  ).report;
  if (report && typeof report.writeReport === "function") {
    try {
      const written = report.writeReport(target) ?? target;
      console.log(st.success(`\nHeap diagnostic written: ${written}\n`));
      return "continue";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(
        st.warning(`process.report.writeReport failed (${msg}); falling back.`),
      );
    }
  }
  try {
    const snapshot = {
      timestamp: ts,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      memoryUsage: process.memoryUsage(),
      resourceUsage:
        typeof process.resourceUsage === "function"
          ? process.resourceUsage()
          : null,
      uptimeSeconds: process.uptime(),
    };
    fs.writeFileSync(target, JSON.stringify(snapshot, null, 2));
    console.log(st.success(`\nHeap snapshot fallback written: ${target}\n`));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(st.error(`\nCould not write heap snapshot: ${msg}\n`));
  }
  return "continue";
}

async function slashTrust(args: string[]): Promise<SlashResult> {
  const sub = (args[0] ?? "status").toLowerCase();
  const trustMod = await import("../utils/workspace-trust.js");

  if (sub === "list") {
    const entries = trustMod.listTrustedPaths();
    if (entries.length === 0) {
      console.log(st.dim("\nNo trusted workspaces.\n"));
      return "continue";
    }
    console.log(st.bold("\nTrusted workspaces\n"));
    for (const entry of entries) {
      const ts = new Date(entry.trustedAt).toLocaleString();
      console.log(
        st.brand(entry.path),
        st.dim(`  level=${entry.level} since ${ts}`),
      );
    }
    console.log("");
    return "continue";
  }

  if (sub === "add") {
    const target = args[1];
    if (!target) {
      console.log(st.warning("Usage: /trust add <path> [session|always]"));
      return "continue";
    }
    const levelArg = (args[2] ?? "always").toLowerCase();
    const level = levelArg === "session" ? "session" : ("always" as const);
    trustMod.trustPath(target, level);
    console.log(st.success(`Trusted ${target} (${level}).\n`));
    return "continue";
  }

  if (sub === "remove" || sub === "rm") {
    const target = args[1];
    if (!target) {
      console.log(st.warning("Usage: /trust remove <path>"));
      return "continue";
    }
    trustMod.untrustPath(target);
    console.log(st.success(`Removed trust for ${target}.\n`));
    return "continue";
  }

  if (sub === "status") {
    const cwd = process.cwd();
    const level = trustMod.getTrustLevel(cwd);
    console.log(st.bold("\nWorkspace trust\n"));
    console.log(st.brand("CWD:"), cwd);
    if (level) {
      console.log(st.brand("Trust:"), st.success(level));
    } else {
      console.log(st.brand("Trust:"), st.dim("not set"));
    }
    console.log("");
    return "continue";
  }

  console.log(
    st.dim(
      "Usage: /trust list | /trust add <path> [session|always] | /trust remove <path> | /trust status\n",
    ),
  );
  return "continue";
}

async function slashVerify(args: string[]): Promise<SlashResult> {
  const url = args[0];
  if (!url) {
    console.log(st.warning("Usage: /verify <url> [selector]"));
    return "continue";
  }
  const selector = args[1];
  try {
    const { runVerify } = await import("../utils/verify-runner.js");
    const r = await runVerify({ url, selector });
    console.log(st.success(`Screenshot saved: ${r.screenshotPath}`));
    if (r.videoPath) console.log(st.dim(`Video: ${r.videoPath}`));
    console.log(st.dim(`Page: ${r.domSummary}`));
    console.log(st.dim(`Duration: ${r.durationMs}ms\n`));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(st.error(msg));
  }
  return "continue";
}

async function slashDream(args: string[]): Promise<SlashResult> {
  const prompt = args.join(" ").trim();
  if (!prompt) {
    console.log(st.warning("Usage: /dream <prompt>"));
    return "continue";
  }
  console.log(st.dim("Generating image..."));
  try {
    const { generateImage } = await import("../utils/image-gen-client.js");
    const r = await generateImage({ prompt });
    console.log(st.success(`Image saved: ${r.filePath}`));
    if (r.revisedPrompt) {
      console.log(st.dim(`Revised prompt: ${r.revisedPrompt}`));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(st.error(msg));
  }
  return "continue";
}

async function slashSubAgent(args: string[]): Promise<SlashResult> {
  const { subAgentsListCommand, subAgentsRunCommand } =
    await import("./sub-agents.js");
  if (args.length === 0 || args[0] === "list") {
    await subAgentsListCommand();
    return "continue";
  }
  const name = args[0];
  const prompt = args.slice(1).join(" ").trim();
  if (!name || !prompt) {
    console.log(st.warning("Usage: /sub-agent <name> <prompt>"));
    return "continue";
  }
  await subAgentsRunCommand(name, prompt);
  return "continue";
}

async function slashBatch(args: string[]): Promise<SlashResult> {
  if (args.length < 2 || !/^\d+$/.test(args[0] ?? "")) {
    console.log(st.warning("Usage: /batch <N> <task description>"));
    return "continue";
  }
  const count = parseInt(args[0]!, 10);
  const topic = args.slice(1).join(" ").trim();
  if (count < 1 || count > 30) {
    console.log(st.error("Batch count must be 1..30"));
    return "continue";
  }
  if (!topic) {
    console.log(st.warning("Usage: /batch <N> <task description>"));
    return "continue";
  }
  console.log(st.dim(`Spawning ${count} batch worker(s)...`));
  try {
    const { runBatch } = await import("../utils/batch-executor.js");
    const results = await runBatch({ count, topic, openPRs: false });
    for (const r of results) {
      const marker =
        r.status === "success" ? st.success("ok") : st.error(r.status);
      console.log(
        `${marker} ${r.task.id}: ${r.task.worktreePath} (${r.durationMs}ms)`,
      );
      if (r.prUrl) console.log(st.dim(`  PR: ${r.prUrl}`));
      if (r.error) console.log(st.dim(`  ${r.error}`));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(st.error(`Batch failed: ${msg}`));
  }
  return "continue";
}

async function slashSimplify(): Promise<SlashResult> {
  console.log(st.dim("Running simplify review with 3 parallel reviewers..."));
  const { runSimplify } = await import("../utils/simplify-runner.js");
  const { getGitDiff } = await import("../utils/git-context.js");
  const diff = getGitDiff();
  if (!diff) {
    console.log(st.warning("No recent edits to review (git diff empty)"));
    return "continue";
  }
  try {
    const result = await runSimplify({ recentEdits: diff });
    console.log(st.bold(`\nFindings (${result.findings.length}):`));
    for (const f of result.findings) {
      const sev =
        f.severity === "critical"
          ? st.error(f.severity)
          : f.severity === "major"
            ? st.warning(f.severity)
            : st.dim(f.severity);
      const loc = f.file ? `${f.file}${f.line ? ":" + f.line : ""} ` : "";
      console.log(`  [${sev}] ${f.reviewer}: ${loc}${f.message}`);
    }
    if (result.consensusFixes.length > 0) {
      console.log(st.bold("\nConsensus fixes:"));
      for (const fix of result.consensusFixes) {
        console.log(`  - ${fix}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(st.error(`Simplify failed: ${msg}`));
  }
  return "continue";
}

async function slashCodebase(args: string[]): Promise<SlashResult> {
  const rootInfo = resolveProjectRoot(process.cwd());
  const scopePath = rootInfo.root;
  const sub = args[0]?.toLowerCase();

  if (sub === "allow" || sub === "grant") {
    const ok = await requestCodebasePermission(scopePath);
    console.log(
      ok
        ? st.success("Codebase read access granted for this project scope.")
        : st.warning("Not granted."),
    );
    console.log("");
    return "continue";
  }

  if (sub === "revoke") {
    revokeCodebasePermission(scopePath);
    console.log(st.success("Revoked codebase permission for this project.\n"));
    return "continue";
  }

  if (sub === "status") {
    const h = hasCodebasePermission(scopePath);
    console.log(st.bold("\nCodebase permission\n"));
    if (h === true)
      console.log(st.success("Granted"), st.dim("for"), scopePath);
    else if (h === false)
      console.log(
        st.warning("Previously denied"),
        st.dim("- run /codebase allow to try again"),
      );
    else
      console.log(
        st.dim("Not set yet"),
        st.dim("- run /codebase allow before codebase-aware debates"),
      );
    console.log("");
    return "continue";
  }

  console.log(
    st.dim("Usage: /codebase allow | /codebase status | /codebase revoke"),
  );
  console.log(
    st.dim("  allow   - prompt to allow reading project files for debates"),
  );
  console.log(st.dim("  status  - show whether this directory is allowed"));
  console.log(st.dim("  revoke  - remove saved permission for this directory"));
  console.log("");
  return "continue";
}

async function slashPermissions(args: string[]): Promise<SlashResult> {
  const rootInfo = resolveProjectRoot(process.cwd());
  const scopePath = rootInfo.root;
  const sub = (args[0] || "status").toLowerCase();

  if (sub === "allow-write") {
    const level = await requestWritePermission(scopePath);
    if (level === "deny") console.log(st.warning("Write permission denied."));
    else console.log(st.success(`Write permission granted: ${level}`));
    console.log("");
    return "continue";
  }

  if (sub === "revoke-write") {
    revokeWritePermission(scopePath);
    console.log(
      st.success("Revoked write permission for this project scope.\n"),
    );
    return "continue";
  }

  const snapshot = getPermissionSnapshot(scopePath);
  console.log(st.bold("\nPermission dashboard\n"));
  console.log(st.brand("Scope:"), snapshot.scopePath);
  console.log(st.brand("Read codebase:"), snapshot.readCodebase);
  console.log(st.brand("Write files:"), snapshot.writeFiles);
  console.log("");
  return "continue";
}

async function slashApply(session: ChatSession): Promise<SlashResult> {
  if (!session.lastGoldenPrompt) {
    console.log(
      st.warning("No synthesis available to apply. Run a debate first.\n"),
    );
    return "continue";
  }

  const rootInfo = resolveProjectRoot(process.cwd());
  const parsed = parseEditsFromSynthesis(
    session.lastGoldenPrompt,
    rootInfo.root,
  );
  if (parsed.edits.length === 0) {
    console.log(st.warning("No structured edits found in last synthesis."));
    console.log(
      st.dim("Expected format: ```consilium-edits with JSON edit entries.\n"),
    );
    return "continue";
  }

  console.log(st.bold("\nPlanned edits\n"));
  console.log(formatEditPreview(parsed.preview));
  console.log("");

  const level = await requestWritePermission(rootInfo.root);
  if (level === "deny" || !consumeWritePermission(rootInfo.root)) {
    console.log(
      st.warning("Write permission denied. No files were changed.\n"),
    );
    return "continue";
  }

  const result = applyEdits(rootInfo.root, parsed.edits);
  console.log(
    st.success(`Applied ${result.applied} edit(s).`),
    st.dim(`Rollback snapshot: ${result.snapshot.id}\n`),
  );
  return "continue";
}

async function slashRollback(args: string[]): Promise<SlashResult> {
  const snapshotId = args[0]?.trim();
  const historyDir = path.join(
    process.env.HOME || process.env.USERPROFILE || "",
    ".consilium",
    "edit-history",
  );

  if (!snapshotId) {
    try {
      const entries = fs
        .readdirSync(historyDir)
        .filter((e) => e.startsWith("edit_"))
        .sort()
        .reverse()
        .slice(0, 10);
      if (entries.length === 0) {
        console.log(st.dim("\nNo edit snapshots found.\n"));
        return "continue";
      }
      console.log(st.bold("\nRecent edit snapshots (newest first)\n"));
      for (const entry of entries) {
        const snapshotFile = path.join(historyDir, entry, "snapshot.json");
        try {
          const snap = JSON.parse(
            fs.readFileSync(snapshotFile, "utf-8"),
          ) as RollbackSnapshot;
          const files = snap.files.map((f) => f.path).join(", ");
          console.log(
            st.brand(entry),
            st.dim(
              `  ${snap.createdAt}  ${snap.files.length} file(s): ${files}`,
            ),
          );
        } catch {
          console.log(st.brand(entry));
        }
      }
      console.log(st.dim("\nUsage: /rollback <snapshotId>\n"));
    } catch {
      console.log(st.dim("\nNo edit snapshots found.\n"));
    }
    return "continue";
  }

  const snapshotFile = path.join(historyDir, snapshotId, "snapshot.json");
  if (!fs.existsSync(snapshotFile)) {
    console.log(st.error(`Snapshot not found: ${snapshotId}\n`));
    return "continue";
  }

  let snapshot: RollbackSnapshot;
  try {
    snapshot = JSON.parse(
      fs.readFileSync(snapshotFile, "utf-8"),
    ) as RollbackSnapshot;
  } catch {
    console.log(st.error("Could not read snapshot file.\n"));
    return "continue";
  }

  console.log(
    st.bold(
      `\nRolling back ${snapshot.files.length} file(s) from ${snapshot.createdAt}\n`,
    ),
  );
  for (const f of snapshot.files) {
    console.log(st.dim(`  ${f.existed ? "restore" : "delete"} ${f.path}`));
  }
  console.log("");

  restoreRollbackSnapshot(snapshot);
  console.log(st.success("Rollback complete.\n"));
  return "continue";
}

async function slashReview(
  args: string[],
  session: ChatSession,
): Promise<SlashResult> {
  const filePath = args[0]?.trim();
  if (!filePath) {
    console.log(
      st.dim(
        "Usage: /review <file-path>  - sends a file for targeted code review debate\n",
      ),
    );
    return "continue";
  }
  const rootInfo = resolveProjectRoot(process.cwd());
  const fullPath = path.resolve(rootInfo.root, filePath);
  if (!fs.existsSync(fullPath)) {
    console.log(st.error(`File not found: ${filePath}\n`));
    return "continue";
  }
  let content: string;
  try {
    content = fs.readFileSync(fullPath, "utf-8");
  } catch {
    console.log(st.error(`Cannot read file: ${filePath}\n`));
    return "continue";
  }
  session.contextManager.addFile(fullPath);
  console.log(
    st.success(
      `Added ${filePath} to context. Your next debate will review this file.\n`,
    ),
  );
  console.log(
    st.dim(
      `Tip: ask "Review ${filePath} for bugs, style issues, and improvements"\n`,
    ),
  );
  return "continue";
}

function slashEditHistory(): SlashResult {
  const auditFile = path.join(
    process.env.HOME || process.env.USERPROFILE || "",
    ".consilium",
    "edit-history",
    "audit.jsonl",
  );
  if (!fs.existsSync(auditFile)) {
    console.log(st.dim("\nNo edit history found.\n"));
    return "continue";
  }
  const lines = fs
    .readFileSync(auditFile, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .slice(-20)
    .reverse();
  if (lines.length === 0) {
    console.log(st.dim("\nNo edit history found.\n"));
    return "continue";
  }
  console.log(st.bold("\nRecent edits (newest first)\n"));
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as {
        ts: string;
        snapshotId: string;
        files: string[];
        count: number;
      };
      const files =
        entry.files.slice(0, 3).join(", ") +
        (entry.files.length > 3 ? ` +${entry.files.length - 3} more` : "");
      console.log(
        st.brand(entry.snapshotId),
        st.dim(`  ${entry.ts}  ${entry.count} file(s): ${files}`),
      );
    } catch (err: unknown) {
      console.log(
        st.dim(
          `(malformed entry: ${err instanceof Error ? err.message : String(err)})`,
        ),
      );
    }
  }
  console.log(st.dim("\nUse /rollback <snapshotId> to restore.\n"));
  return "continue";
}

async function slashGitDiff(): Promise<SlashResult> {
  const rootInfo = resolveProjectRoot(process.cwd());
  const branch = getCurrentBranch(rootInfo.root);
  const diff = getGitDiff(rootInfo.root);
  if (!diff) {
    console.log(st.dim("\nNo uncommitted changes in the working tree.\n"));
    return "continue";
  }
  console.log(st.bold(`\nGit diff${branch ? ` (${branch})` : ""}\n`));
  const truncated =
    diff.length > 6000 ? diff.slice(0, 6000) + "\n... (truncated)" : diff;
  console.log(truncated);
  console.log("");

  if (!process.stdin.isTTY) {
    return "continue";
  }

  const answer = await new Promise<string>((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(st.dim("Open interactive navigator? [y/N] "), (input) => {
      rl.close();
      resolve(input.trim().toLowerCase());
    });
  });

  if (answer !== "y" && answer !== "yes") {
    return "continue";
  }

  const hunks = parseUnifiedDiff(diff);
  if (hunks.length === 0) {
    console.log(st.dim("\nNo diff to navigate.\n"));
    return "continue";
  }

  try {
    await navigateDiffs(hunks);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(st.error(`\nNavigator error: ${msg}\n`));
  }
  console.log("");
  return "continue";
}

function slashScope(): SlashResult {
  const rootInfo = resolveProjectRoot(process.cwd());
  console.log(st.bold("\nScope info\n"));
  console.log(st.brand("CWD:"), rootInfo.cwd);
  console.log(st.brand("Project root:"), rootInfo.root);
  console.log(st.brand("Git repo:"), rootInfo.isGitRepo ? "yes" : "no");
  if (rootInfo.isSubdirectory) {
    console.log(
      st.warning(
        "Launched from subdirectory - full project context is loaded from root.",
      ),
    );
  }
  console.log("");
  return "continue";
}

async function slashCheckpoint(
  args: string[],
  session: ChatSession,
  sessionManager: SessionManager,
): Promise<SlashResult> {
  const name = args.join(" ").trim() || undefined;
  if (!session.id) {
    sessionManager.saveSession(session);
  }
  const sessionId = session.id;
  if (!sessionId) {
    console.log(st.error("Could not determine session id for checkpoint.\n"));
    return "continue";
  }
  try {
    const mod = await import("../utils/session-manager.js");
    if (typeof mod.snapshotSession !== "function") {
      console.log(st.warning("Checkpoint feature not yet available.\n"));
      return "continue";
    }
    const snap = mod.snapshotSession(sessionId, name);
    console.log(st.success("Checkpoint created:"), st.brand(snap.id));
    if (snap.label) console.log(st.dim(`  label: ${snap.label}`));
    console.log(st.dim(`  use /rewind ${snap.id} to restore this snapshot\n`));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(st.warning(`Checkpoint not yet available: ${msg}\n`));
  }
  return "continue";
}

async function slashRewind(
  args: string[],
  session: ChatSession,
  sessionManager: SessionManager,
): Promise<SlashResult> {
  const snapshotId = args[0]?.trim();
  const sessionId = session.id;
  if (!sessionId) {
    console.log(
      st.warning("No active session id. Save the session first with /save.\n"),
    );
    return "continue";
  }

  let mod: typeof import("../utils/session-manager.js");
  try {
    mod = await import("../utils/session-manager.js");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(st.warning(`Rewind not yet available: ${msg}\n`));
    return "continue";
  }

  if (!snapshotId) {
    if (typeof mod.listSnapshots !== "function") {
      console.log(st.warning("Snapshot listing not yet available.\n"));
      return "continue";
    }
    const snaps = mod.listSnapshots(sessionId);
    if (snaps.length === 0) {
      console.log(
        st.dim(
          "\nNo snapshots for this session. Use /checkpoint to create one.\n",
        ),
      );
      return "continue";
    }
    console.log(st.bold("\nAvailable snapshots (newest first)\n"));
    for (const snap of snaps) {
      const label = snap.label ? ` ${st.dim(`(${snap.label})`)}` : "";
      const ts = new Date(snap.createdAt).toLocaleString();
      console.log(st.brand(snap.id), st.dim(` ${ts}`), label);
    }
    console.log(st.dim("\nUsage: /rewind <snapshot-id>\n"));
    return "continue";
  }

  try {
    if (typeof mod.restoreSnapshot !== "function") {
      console.log(st.warning("Restore not yet available.\n"));
      return "continue";
    }
    mod.restoreSnapshot(sessionId, snapshotId);
    const loaded = sessionManager.loadSession(sessionId);
    session.debates = loaded.debates || [];
    session.name = loaded.name || session.name;
    session.models = loaded.models || session.models;
    session.mode = loaded.mode;
    session.lastGoldenPrompt = loaded.lastGoldenPrompt;
    session.contextFilePaths = loaded.contextFilePaths || [];
    session.contextImagePaths = loaded.contextImagePaths || [];
    console.log(
      st.success(`Restored snapshot ${snapshotId}.`),
      st.dim(`  ${session.debates.length} debate(s) in restored state\n`),
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(st.error(`Could not restore snapshot: ${msg}\n`));
  }
  return "continue";
}

async function slashFork(
  args: string[],
  session: ChatSession,
  sessionManager: SessionManager,
): Promise<SlashResult> {
  const name = args.join(" ").trim() || undefined;
  if (!session.id) {
    sessionManager.saveSession(session);
  }
  const sessionId = session.id;
  if (!sessionId) {
    console.log(st.error("Could not determine session id for fork.\n"));
    return "continue";
  }
  try {
    const mod = await import("../utils/session-manager.js");
    if (typeof mod.forkSession !== "function") {
      console.log(st.warning("Fork not yet available.\n"));
      return "continue";
    }
    const newId = mod.forkSession(sessionId, name);
    console.log(
      st.success("Forked session:"),
      st.brand(newId),
      st.dim(`  resume with: consilium sessions resume ${newId}\n`),
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(st.warning(`Fork not yet available: ${msg}\n`));
  }
  return "continue";
}

function slashLoop(args: string[], session: ChatSession): SlashResult {
  if (args.length < 2) {
    console.log(st.warning("Usage: /loop <minutes> <prompt>"));
    console.log(
      st.dim("  Examples: /loop 5 check the deploy, /loop 30m run tests\n"),
    );
    return "continue";
  }
  const durationToken = args[0] ?? "";
  const promptText = args.slice(1).join(" ").trim();
  if (!promptText) {
    console.log(st.warning("Loop prompt is required.\n"));
    return "continue";
  }
  const numeric = /^\d+(\.\d+)?$/.test(durationToken)
    ? `${durationToken}m`
    : durationToken;
  const intervalMs = parseDurationToMs(numeric);
  if (!intervalMs || intervalMs < 1000) {
    console.log(
      st.warning(
        "Invalid interval. Use minutes (e.g. 5) or 30m, 1h, 2h, 1d.\n",
      ),
    );
    return "continue";
  }

  const extras = getExtras(session);
  const id = makeLocalId("loop");
  const sessionId = session.id ?? "__pending__";
  const timer = setInterval(() => {
    console.log(st.dim(`\n[loop ${id}] tick - prompt queued: ${promptText}\n`));
    try {
      updateLoopLastRun(sessionId, id, Date.now());
    } catch {
      // best-effort metadata refresh
    }
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  extras.loops.set(id, { id, intervalMs, prompt: promptText, timer });

  try {
    persistLoop({
      id,
      sessionId,
      intervalMs,
      prompt: promptText,
      createdAt: Date.now(),
    });
  } catch {
    // best-effort persistence; loop still runs in-process
  }

  console.log(
    st.success(
      `Loop registered (${id}). Will run every ${formatDurationMs(intervalMs)}.`,
    ),
  );
  console.log(
    st.dim(
      "  Loops persist across /exit and resume on next chat for this session.\n",
    ),
  );
  return "continue";
}

function slashGoal(args: string[], session: ChatSession): SlashResult {
  const extras = getExtras(session);
  const sessionId = session.id ?? "__pending__";
  const sub = args[0]?.toLowerCase();
  if (!args.length) {
    if (extras.goal) {
      console.log(st.bold("\nSession goal\n"));
      console.log(st.brand("Working toward:"), extras.goal);
      console.log(st.dim("\nUse /goal clear to remove.\n"));
    } else {
      console.log(st.dim("\nNo goal set. Usage: /goal <text>\n"));
    }
    return "continue";
  }
  if (sub === "clear" || sub === "reset" || sub === "remove") {
    extras.goal = undefined;
    try {
      clearGoal(sessionId);
    } catch {
      // best-effort
    }
    console.log(st.success("Session goal cleared.\n"));
    return "continue";
  }
  const text = args.join(" ").trim();
  if (!text) {
    console.log(st.warning("Goal text is required.\n"));
    return "continue";
  }
  extras.goal = text;
  try {
    persistGoal({ sessionId, text, setAt: Date.now() });
  } catch {
    // best-effort persistence
  }
  console.log(
    st.success("Session goal set."),
    st.dim('  Future turns will include: "Working toward: ..."\n'),
  );
  return "continue";
}

function slashSchedule(args: string[], session: ChatSession): SlashResult {
  if (args.length < 2) {
    console.log(st.warning("Usage: /schedule <interval> <prompt>"));
    console.log(
      st.dim("  Examples: /schedule 5m check status, /schedule daily digest\n"),
    );
    return "continue";
  }
  const spec = args[0] ?? "";
  const promptText = args.slice(1).join(" ").trim();
  if (!promptText) {
    console.log(st.warning("Scheduled prompt is required.\n"));
    return "continue";
  }
  const intervalMs = parseDurationToMs(spec);
  if (!intervalMs || intervalMs < 1000) {
    console.log(
      st.warning("Invalid interval. Use 5m, 30m, 1h, daily, hourly, etc.\n"),
    );
    return "continue";
  }

  const extras = getExtras(session);
  const id = makeLocalId("sched");
  const sessionId = session.id ?? "__pending__";
  const createdAt = Date.now();
  const timer = setInterval(() => {
    console.log(
      st.dim(`\n[schedule ${id}] tick - prompt queued: ${promptText}\n`),
    );
    try {
      updateScheduleNextRun(sessionId, id, Date.now() + intervalMs, Date.now());
    } catch {
      // best-effort metadata refresh
    }
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  extras.schedules.set(id, {
    id,
    prompt: promptText,
    spec,
    intervalMs,
    timer,
  });

  try {
    persistSchedule({
      id,
      sessionId,
      spec,
      intervalMs,
      nextRunAt: createdAt + intervalMs,
      prompt: promptText,
      createdAt,
    });
  } catch {
    // best-effort persistence; loop still runs in-process
  }

  console.log(
    st.success(`Scheduled (${id}).`),
    st.dim(
      `  Will run every ${formatDurationMs(intervalMs)} (persists across /exit).\n`,
    ),
  );
  return "continue";
}

async function slashPlan(): Promise<SlashResult> {
  try {
    const mod = await import("../utils/plan-mode.js");
    if (
      typeof mod.isPlanModeActive !== "function" ||
      typeof mod.enterPlanMode !== "function" ||
      typeof mod.exitPlanMode !== "function"
    ) {
      console.log(st.warning("Plan mode not yet available.\n"));
      return "continue";
    }
    if (mod.isPlanModeActive()) {
      mod.exitPlanMode();
      console.log(st.success("Plan mode: off"));
      console.log(st.dim("  Writes unblocked.\n"));
    } else {
      mod.enterPlanMode();
      console.log(st.success("Plan mode: on"));
      console.log(
        st.dim(
          "  Steps will be recorded; writes are gated on plan approval.\n",
        ),
      );
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(st.warning(`Plan mode not yet available: ${msg}\n`));
  }
  return "continue";
}

function slashEffort(args: string[], session: ChatSession): SlashResult {
  const valid = ["low", "medium", "high", "xhigh", "max"] as const;
  const extras = getExtras(session);
  const level = args[0]?.toLowerCase() as (typeof valid)[number] | undefined;
  if (!level) {
    const current = extras.reasoningEffort ?? "(default)";
    console.log(st.bold("\nReasoning effort\n"));
    console.log(st.brand("Current:"), current);
    console.log(st.dim(`  Options: ${valid.join(", ")}\n`));
    return "continue";
  }
  if (!(valid as readonly string[]).includes(level)) {
    console.log(
      st.warning(`Invalid effort. Choose from: ${valid.join(", ")}\n`),
    );
    return "continue";
  }
  extras.reasoningEffort = level;
  console.log(
    st.success(`Reasoning effort set: ${level}`),
    st.dim("  Will be sent on subsequent debates when wired upstream.\n"),
  );
  return "continue";
}

function slashTUI(): SlashResult {
  if (!process.stdout.isTTY) {
    console.log(st.warning("Fullscreen mode requires a TTY.\n"));
    return "continue";
  }
  const tui = getTUI();
  if (tui.isActive()) {
    tui.leave();
    console.log(st.dim("Fullscreen mode disabled"));
  } else {
    tui.enter();
    console.log(st.dim("Fullscreen mode enabled. Use /tui again to disable."));
  }
  return "continue";
}

function slashUsage(session: ChatSession): SlashResult {
  const debates = session.debates || [];
  const totalDebates = debates.length;
  const synthChars = debates.reduce(
    (acc, d) => acc + (d.goldenPrompt?.length ?? 0),
    0,
  );
  const topicChars = debates.reduce(
    (acc, d) => acc + (d.topic?.length ?? 0),
    0,
  );
  const approxTokens = Math.ceil((synthChars + topicChars) / 4);

  console.log(st.bold("\nSession usage\n"));
  console.log(st.brand("Debates this session:"), totalDebates);
  console.log(
    st.brand("Approx tokens (chars/4):"),
    approxTokens.toLocaleString(),
  );
  console.log(
    st.dim("  Note: token + cost totals come from cost_update SSE events;"),
  );
  console.log(
    st.dim(
      "  per-debate breakdown is available in the web dashboard (/insights).\n",
    ),
  );
  return "continue";
}

async function slashCustomCommand(
  cmdName: string,
  args: string[],
  session: ChatSession,
): Promise<{ result: SlashResult; prompt?: string }> {
  const extras = getExtras(session);
  const cmd = extras.customCommands.get(cmdName);
  if (!cmd) {
    return { result: "continue" };
  }
  try {
    const mod = await import("../utils/custom-commands.js");
    if (typeof mod.executeCustomCommand !== "function") {
      console.log(st.warning("Custom commands runtime not yet available.\n"));
      return { result: "continue" };
    }
    const prompt = mod.executeCustomCommand(cmd, args);
    console.log(
      st.success(`Custom command /${cmdName} resolved.`),
      st.dim("  Sending as user prompt...\n"),
    );
    return { result: "continue", prompt };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(
      st.warning(`Custom command runtime not yet available: ${msg}\n`),
    );
    return { result: "continue" };
  }
}

async function ensureCustomCommandsLoaded(session: ChatSession): Promise<void> {
  const extras = getExtras(session);
  if (extras.customCommandsLoaded) return;
  extras.customCommandsLoaded = true;
  try {
    const mod = await import("../utils/custom-commands.js");
    if (typeof mod.loadCustomCommands !== "function") return;
    const cmds = await mod.loadCustomCommands();
    for (const cmd of cmds) {
      extras.customCommands.set(cmd.name, cmd);
    }
  } catch {
    // missing module is fine; custom commands are optional
  }
}

function printExtendedHelp(session: ChatSession): void {
  const extras = getExtras(session);
  console.log(st.bold("\n  Session control"));
  console.log(
    st.dim("  /checkpoint [name] - Snapshot current session for later /rewind"),
  );
  console.log(
    st.dim(
      "  /rewind [id]    - Restore a snapshot; no id lists available snapshots",
    ),
  );
  console.log(
    st.dim("  /fork [name]    - Clone this session into a new branch"),
  );
  console.log(st.dim("  /usage          - Show session token + cost summary"));
  console.log(st.bold("\n  Autonomy"));
  console.log(
    st.dim("  /loop <min> <prompt>     - Repeat a prompt every N minutes"),
  );
  console.log(
    st.dim(
      "  /schedule <spec> <prompt> - Schedule a prompt (5m, 1h, daily, ...)",
    ),
  );
  console.log(
    st.dim("  /goal <text>    - Set session goal (preamble for future turns)"),
  );
  console.log(st.dim("  /goal clear     - Remove the goal"));
  console.log(st.bold("\n  Planning"));
  console.log(st.dim("  /plan           - Toggle plan mode (writes gated)"));
  console.log(
    st.dim("  /effort <level> - Reasoning depth: low|medium|high|xhigh|max"),
  );
  console.log(st.bold("\n  Diagnostics"));
  console.log(
    st.dim("  /recap          - One-paragraph summary of last 5 debates"),
  );
  console.log(
    st.dim("  /stop           - Cancel the in-flight debate (if any)"),
  );
  console.log(
    st.dim(
      "  /doctor         - System + API + provider key + autonomy + disk usage",
    ),
  );
  console.log(
    st.dim(
      "  /heapdump       - Write a Node diagnostic report to ~/.consilium/diagnostics/",
    ),
  );
  console.log(st.bold("\n  Memory & Analytics"));
  console.log(
    st.dim("  /memory         - Show project memory notes (auto-curated)"),
  );
  console.log(
    st.dim("  /insights       - Analyze recent sessions for friction patterns"),
  );
  console.log(
    st.dim("  /team-onboarding [path] - Generate a shareable onboarding guide"),
  );

  if (extras.customCommands.size > 0) {
    console.log(st.bold("\n  Custom (~/.consilium/commands/*.md)"));
    for (const cmd of extras.customCommands.values()) {
      const desc = cmd.description ? ` - ${cmd.description}` : "";
      console.log(st.dim(`  /${cmd.name}${desc}`));
    }
  }
  console.log("");
}

async function slashUltraPlan(args: string[]): Promise<SlashResult> {
  const topic = args.join(" ").trim();
  if (!topic) {
    console.log(st.warning("Usage: /ultraplan <topic>"));
    return "continue";
  }
  console.log(st.dim("Running multi-agent plan generation..."));
  try {
    const { runUltraPlan } = await import("../utils/ultraplan.js");
    const result = await runUltraPlan({ topic, save: true });
    console.log(result.markdown);
    if (result.savedTo) {
      console.log(st.success(`\nPlan saved to ${result.savedTo}`));
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(st.error(`UltraPlan failed: ${msg}`));
  }
  return "continue";
}

async function slashUltraReview(args: string[]): Promise<SlashResult> {
  const branch = args[0];
  console.log(st.dim("Running multi-agent code review..."));
  try {
    const { runUltraReview } = await import("../utils/ultrareview.js");
    const result = await runUltraReview({ branch });
    console.log(result.markdown);
    if (result.blocked) {
      console.log(st.error("\nReview BLOCKED - address critical issues"));
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(st.error(`UltraReview failed: ${msg}`));
  }
  return "continue";
}

export async function dispatchSlashCommand(
  cmd: string,
  args: string[],
  session: ChatSession,
  sessionManager: SessionManager,
  _rl: ReadlineInterface,
  delegates: SlashDelegates,
): Promise<SlashResult> {
  await ensureCustomCommandsLoaded(session);
  switch (cmd) {
    case "/exit":
      return slashExit(sessionManager, session);
    case "/help":
      delegates.printHelp();
      printExtendedHelp(session);
      return "continue";
    case "/file":
      return slashFile(args, session);
    case "/image":
      return slashImage(args, session);
    case "/clear":
      return slashClear(session);
    case "/status":
      return slashStatus(session);
    case "/manifest":
      return slashManifest(session);
    case "/models":
      return slashModels(args, session);
    case "/save":
      return slashSave(args, session, sessionManager);
    case "/api":
      return slashApi(args);
    case "/keys":
      return slashKeys(args);
    case "/track":
    case "/insights":
      return slashInsights();
    case "/team-onboarding":
      return slashTeamOnboarding(args);
    case "/memory":
      return slashMemory();
    case "/codebase":
      return slashCodebase(args);
    case "/permissions":
      return slashPermissions(args);
    case "/apply":
      return slashApply(session);
    case "/search": {
      const query = args.join(" ").trim();
      delegates.handleSearchCommand(query, sessionManager);
      return "continue";
    }
    case "/rename":
      delegates.handleRenameCommand(args, session, sessionManager);
      return "continue";
    case "/delete":
      return "delete-pending";
    case "/history":
      delegates.printConversationHistory(session);
      return "continue";
    case "/sessions":
      delegates.handleSessionsListCommand(sessionManager);
      return "continue";
    case "/conversations":
      handleConversationsCommand(sessionManager);
      return "continue";
    case "/context":
      handleContextCommand(session);
      return "continue";
    case "/mode":
      return slashMode(args, session);
    case "/estimate":
      handleEstimateCommand(session.mode, session.models.length);
      return "continue";
    case "/output":
      return slashOutput(args, session);
    case "/workspace":
      await handleWorkspaceCommand(process.cwd());
      return "continue";
    case "/rollback":
      return slashRollback(args);
    case "/review":
      return slashReview(args, session);
    case "/edits":
    case "/edit-history":
      return slashEditHistory();
    case "/gitdiff":
    case "/diff":
      return slashGitDiff();
    case "/scope":
      return slashScope();
    case "/new": {
      session.reset();
      console.log(st.success("Started a new conversation.\n"));
      return "continue";
    }
    case "/resume": {
      const targetId = args[0];
      if (!targetId) {
        console.log(st.warning("Usage: /resume <session-id>"));
        return "continue";
      }
      const loaded = sessionManager.loadSession(targetId);
      if (!loaded) {
        console.log(st.error(`Session "${targetId}" not found.`));
        return "continue";
      }
      session.debates = loaded.debates || [];
      session.id = loaded.id;
      session.name = loaded.name || "";
      console.log(st.success(`Resumed session: ${loaded.name || targetId}`));
      console.log(st.dim(`  ${session.debates.length} previous debate(s)\n`));
      return "continue";
    }
    case "/redo":
    case "/again": {
      const run = delegates.rerunLastDebateWithWorkspace;
      if (!run) {
        console.log(st.warning("Redo is not available in this context.\n"));
        return "continue";
      }
      await run();
      return "continue";
    }
    case "/checkpoint":
      return slashCheckpoint(args, session, sessionManager);
    case "/rewind":
      return slashRewind(args, session, sessionManager);
    case "/fork":
      return slashFork(args, session, sessionManager);
    case "/loop":
      return slashLoop(args, session);
    case "/goal":
      return slashGoal(args, session);
    case "/schedule":
      return slashSchedule(args, session);
    case "/plan":
      return slashPlan();
    case "/effort":
      return slashEffort(args, session);
    case "/usage":
      return slashUsage(session);
    case "/tui":
      return slashTUI();
    case "/recap":
      return slashRecap(session);
    case "/stop":
      return slashStop(session);
    case "/doctor":
      return slashDoctor();
    case "/heapdump":
      return slashHeapdump();
    case "/ultraplan":
      return slashUltraPlan(args);
    case "/ultrareview":
      return slashUltraReview(args);
    case "/sub-agent":
    case "/sub-agents":
      return slashSubAgent(args);
    case "/batch":
      return slashBatch(args);
    case "/simplify":
      return slashSimplify();
    case "/trust":
      return slashTrust(args);
    case "/verify":
      return slashVerify(args);
    case "/dream":
    case "/imagine":
      return slashDream(args);
    default: {
      const name = cmd.startsWith("/") ? cmd.slice(1) : cmd;
      const extras = getExtras(session);
      if (extras.customCommands.has(name)) {
        const outcome = await slashCustomCommand(name, args, session);
        if (outcome.prompt) {
          try {
            await session.debate(outcome.prompt);
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.log(st.error(`Custom command debate failed: ${msg}\n`));
          }
        }
        return outcome.result;
      }
      console.log(
        st.warning(`Unknown command: ${cmd}. Use /help for commands.`),
      );
      return "continue";
    }
  }
}

function rehydrateLoop(session: ChatSession, reg: LoopRegistration): void {
  const extras = getExtras(session);
  if (extras.loops.has(reg.id)) return;
  const timer = setInterval(() => {
    console.log(
      st.dim(`\n[loop ${reg.id}] tick - prompt queued: ${reg.prompt}\n`),
    );
    try {
      updateLoopLastRun(reg.sessionId, reg.id, Date.now());
    } catch {
      // best-effort
    }
  }, reg.intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  extras.loops.set(reg.id, {
    id: reg.id,
    intervalMs: reg.intervalMs,
    prompt: reg.prompt,
    timer,
  });
}

function rehydrateSchedule(
  session: ChatSession,
  reg: ScheduleRegistration,
): void {
  const extras = getExtras(session);
  if (extras.schedules.has(reg.id)) return;
  const tick = (): void => {
    console.log(
      st.dim(`\n[schedule ${reg.id}] tick - prompt queued: ${reg.prompt}\n`),
    );
    try {
      updateScheduleNextRun(
        reg.sessionId,
        reg.id,
        Date.now() + reg.intervalMs,
        Date.now(),
      );
    } catch {
      // best-effort
    }
  };
  const now = Date.now();
  const due = Math.max(0, reg.nextRunAt - now);
  if (due === 0) {
    tick();
  }
  const timer = setInterval(tick, reg.intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  extras.schedules.set(reg.id, {
    id: reg.id,
    prompt: reg.prompt,
    spec: reg.spec,
    intervalMs: reg.intervalMs,
    timer,
  });
}

export function replayAutonomy(session: ChatSession): {
  loops: number;
  schedules: number;
  goal: boolean;
} {
  const sessionId = session.id ?? "__pending__";
  const extras = getExtras(session);
  let loops = 0;
  let schedules = 0;
  let goalLoaded = false;

  try {
    const persistedLoops = listLoopsForSession(sessionId);
    for (const reg of persistedLoops) {
      rehydrateLoop(session, reg);
      loops += 1;
    }
  } catch {
    // ignore corrupt persistence; CLI keeps running
  }

  try {
    const persistedSchedules = listSchedulesForSession(sessionId);
    for (const reg of persistedSchedules) {
      rehydrateSchedule(session, reg);
      schedules += 1;
    }
  } catch {
    // ignore corrupt persistence
  }

  try {
    const goal = getGoalForSession(sessionId);
    if (goal?.text) {
      extras.goal = goal.text;
      goalLoaded = true;
    }
  } catch {
    // ignore
  }

  return { loops, schedules, goal: goalLoaded };
}

export function clearAutonomyLoop(session: ChatSession, id: string): boolean {
  const sessionId = session.id ?? "__pending__";
  const extras = getExtras(session);
  const handle = extras.loops.get(id);
  if (handle) {
    clearInterval(handle.timer);
    extras.loops.delete(id);
  }
  try {
    removeLoop(sessionId, id);
  } catch {
    // ignore
  }
  return handle !== undefined;
}

export function clearAutonomySchedule(
  session: ChatSession,
  id: string,
): boolean {
  const sessionId = session.id ?? "__pending__";
  const extras = getExtras(session);
  const handle = extras.schedules.get(id);
  if (handle) {
    clearInterval(handle.timer);
    extras.schedules.delete(id);
  }
  try {
    removeSchedule(sessionId, id);
  } catch {
    // ignore
  }
  return handle !== undefined;
}
