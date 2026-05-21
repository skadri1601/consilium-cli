import fs from "node:fs";
import path from "node:path";
import type { Interface as ReadlineInterface } from "node:readline";
import { ChatSession } from "./chat-session";
import { SessionManager } from "../utils/session-manager";
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
import { style } from "../utils/visual-system";
import {
  handleConversationsCommand,
  handleContextCommand,
  handleModeCommand,
  handleEstimateCommand,
  handleOutputCommand,
  handleWorkspaceCommand,
} from "../utils/chat-commands";
import { log } from "../utils/logger";

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

function slashInsights(): SlashResult {
  const config = loadConfig();
  const webUrl =
    config.webUrl || process.env.CONSILIUM_WEB_URL || DEFAULT_WEB_ORIGIN;
  const url = `${webUrl.replace(/\/$/, "")}/analytics`;
  console.log(st.brand("Opening usage and analytics in browser..."));
  openBrowser(url);
  console.log(st.success("Opened:"), url);
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
      console.log("");
    } catch {
      console.log(st.error("Could not reach API for key status.\n"));
    }
    return "continue";
  }

  console.log(st.dim("Usage: /keys [open|status]"));
  console.log("");
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

export async function dispatchSlashCommand(
  cmd: string,
  args: string[],
  session: ChatSession,
  sessionManager: SessionManager,
  _rl: ReadlineInterface,
  delegates: SlashDelegates,
): Promise<SlashResult> {
  switch (cmd) {
    case "/exit":
      return slashExit(sessionManager, session);
    case "/help":
      delegates.printHelp();
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
    default:
      console.log(
        st.warning(`Unknown command: ${cmd}. Use /help for commands.`),
      );
      return "continue";
  }
}
