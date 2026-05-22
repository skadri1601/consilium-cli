import readline from "node:readline";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import ora from "ora";
import { ConsiliumClient } from "../api/client";
import { ContextManager } from "../utils/context-manager";
import { ChatSession } from "./chat-session";
import { SessionManager } from "../utils/session-manager";
import { requireAuth } from "../utils/require-auth";
import { DEFAULT_API_ORIGIN, loadConfig } from "../utils/config";
import {
  border,
  borderBottom,
  contentLine,
  style,
} from "../utils/visual-system";
import { formatPrompt } from "../utils/prompt-renderer";
import { terminal } from "../utils/terminal-capabilities";
import { loadWorkspaceDebateContext } from "../utils/workspace-debate-context";
import { log } from "../utils/logger";
import { dispatchSlashCommand } from "./chat-slash-dispatch";
import { requestCodebasePermission } from "../utils/codebase-permissions";
import { resolveProjectRoot } from "../utils/project-root";
import { getActiveTheme, type Theme } from "../utils/themes";
import {
  cycleMode,
  describeMode,
  getCurrentMode,
  type PermissionMode,
} from "../utils/permission-modes";
import {
  parseAtMentions,
  isShellPassthrough,
  extractShellCommand,
  isDangerousShellCommand,
  attachImage,
  attachBase64Image,
  detectImageBase64Mime,
  isImagePath,
} from "../utils/chat-input-parser";
import { getTUI } from "../utils/tui-renderer";
import { safeRunHooks, shouldBlock } from "../hooks/runner";
import { renderStatusLine, getCurrentContext } from "../utils/status-line";
import { loadMemory } from "../utils/auto-memory";

const DEFAULT_SESSION_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || "",
  ".consilium",
  "sessions",
);

const INPUT_HISTORY_SIZE = 100;
const MAX_AT_FILE_BYTES = 100 * 1024;
const MAX_AT_MENTIONS_PER_INPUT = 8;

const DEFAULT_PROMPT = "consilium > ";

type VimMode = "INSERT" | "NORMAL";

interface VimState {
  enabled: boolean;
  mode: VimMode;
  pendingKey: string | null;
}

const vimState: VimState = {
  enabled:
    process.env.CONSILIUM_VIM_MODE === "1" ||
    process.env.CONSILIUM_VIM_MODE === "true",
  mode: "INSERT",
  pendingKey: null,
};

const st = style();
const theme: Theme = getActiveTheme();
const w = terminal.width;

function vimSuffix(): string {
  if (!vimState.enabled) return "";
  const tag = vimState.mode === "NORMAL" ? "[NORMAL]" : "[INSERT]";
  return terminal.hasColor ? theme.dim(tag + " ") : tag + " ";
}

function modeIndicator(): string {
  let mode: PermissionMode;
  try {
    mode = getCurrentMode();
  } catch {
    return "";
  }
  const tag = `[${mode}]`;
  if (!terminal.hasColor) return tag + " ";
  if (mode === "plan") return theme.warning(tag) + " ";
  if (mode === "bypass") return theme.error(tag) + " ";
  if (mode === "acceptEdits" || mode === "auto") return theme.brand(tag) + " ";
  return theme.dim(tag) + " ";
}

function getPrompt(session: ChatSession): string {
  const base = formatPrompt({ fileCount: session.contextFilePaths.length });
  return `${modeIndicator()}${vimSuffix()}${base} `;
}

function printWelcome(): void {
  console.log(theme.dim("\n" + border("Consilium", w)));
  console.log(contentLine("  Multi-Agent Debate Platform", w));
  console.log(contentLine("", w));
  console.log(contentLine("  Type your question to start a debate", w));
  console.log(
    contentLine(
      "  Use / for commands  -  @file to attach  -  !cmd for shell  -  Ctrl+C to exit",
      w,
    ),
  );
  console.log(contentLine("", w));
  console.log(theme.dim(borderBottom(w)) + "\n");
}

function printHelp(): void {
  console.log(theme.bold("\nCommands:\n"));
  console.log(theme.bold("  Debate"));
  console.log(
    theme.dim("  /ask <topic>    - Run one debate (same as typing the topic)"),
  );
  console.log(
    theme.dim(
      "  /mode [mode]    - Set debate mode: quick, council, deep, blind",
    ),
  );
  console.log(
    theme.dim("  /estimate       - Show cost estimate for next debate"),
  );
  console.log(
    theme.dim(
      "  /output [fmt]   - Set output format: markdown, cursorrules, claude-md, json, text",
    ),
  );
  console.log(theme.bold("\n  Context"));
  console.log(
    theme.dim(
      "  /file <path>    - Add file to context (max 100KB per file, 500KB total)",
    ),
  );
  console.log(theme.dim("  /image <path>   - Add image to context"));
  console.log(
    theme.dim(
      "  @path/to/file   - Inline a file's content into your next message",
    ),
  );
  console.log(
    theme.dim(
      "  !cmd            - Run a shell command without sending to a debate",
    ),
  );
  console.log(
    theme.dim("  /workspace      - Detect project and show workspace info"),
  );
  console.log(
    theme.dim("  /context        - Show context window usage and token budget"),
  );
  console.log(theme.dim("  /clear          - Clear context"));
  console.log(theme.bold("\n  Session"));
  console.log(theme.dim("  /status         - Show session status"));
  console.log(
    theme.dim(
      "  /manifest       - Show workspace context manifest (loaded/skipped files)",
    ),
  );
  console.log(
    theme.dim("  /models [m1 ..] - Set models; no args to show current"),
  );
  console.log(
    theme.dim("  /save [file]    - Save synthesis to file, or session to disk"),
  );
  console.log(theme.dim("  /history        - Show conversation history"));
  console.log(theme.dim("  /conversations  - List recent conversations"));
  console.log(theme.dim("  /new            - Start a new conversation"));
  console.log(theme.dim("  /sessions       - List all saved sessions"));
  console.log(theme.dim("  /resume <id>    - Resume a saved session"));
  console.log(theme.dim("  /search <query> - Search across all conversations"));
  console.log(theme.dim("  /rename <name>  - Rename current session"));
  console.log(theme.dim("  /delete <id>    - Delete a saved session"));
  console.log(theme.bold("\n  Config"));
  console.log(
    theme.dim(
      "  /api            - Show API key status; /api set <key> or /api open",
    ),
  );
  console.log(
    theme.dim(
      "  /keys [open|status] - Provider LLM keys page or account status",
    ),
  );
  console.log(theme.dim("  /track, /insights - Open web analytics (usage)"));
  console.log(
    theme.dim(
      "  /codebase       - allow | status | revoke local file read for debates",
    ),
  );
  console.log(
    theme.dim(
      "  /permissions    - status | allow-write | revoke-write for read/write policy",
    ),
  );
  console.log(
    theme.dim(
      "  /apply          - Apply structured edits from latest synthesis (preview + permission gated)",
    ),
  );
  console.log(
    theme.dim(
      "  /redo, /again   - Re-run last topic with current workspace permission and files",
    ),
  );
  console.log(theme.dim("  /help           - Show this help"));
  console.log(theme.dim("  /exit           - Exit and save session"));
  console.log(theme.dim("\n  ↑/↓ - Input history  -  Esc/i toggle vim mode\n"));
}

function printConversationHistory(session: ChatSession): void {
  if (session.debates.length === 0) {
    console.log(theme.dim("\nNo debates in this session yet.\n"));
    return;
  }

  console.log(theme.bold("\nConversation History:\n"));
  let historyIndex = 0;
  for (const d of session.debates) {
    historyIndex += 1;
    const topicPreview =
      d.topic.length > 70 ? d.topic.substring(0, 70) + "..." : d.topic;
    const time = d.timestamp
      ? theme.dim(` (${new Date(d.timestamp).toLocaleString()})`)
      : "";
    console.log(theme.brand(`  ${historyIndex}.`), topicPreview + time);

    if (d.goldenPrompt) {
      const synthPreview =
        d.goldenPrompt.length > 100
          ? d.goldenPrompt.substring(0, 100) + "..."
          : d.goldenPrompt;
      console.log(theme.dim(`     Synthesis: ${synthPreview}`));
    }
  }
  console.log("");
}

function handleSearchCommand(
  query: string,
  sessionManager: SessionManager,
): void {
  if (!query) {
    console.log(theme.warning("Usage: /search <query>"));
    return;
  }

  const results = sessionManager.searchSessions(query);
  if (results.length === 0) {
    console.log(theme.dim(`\nNo results for "${query}".\n`));
    return;
  }

  console.log(theme.bold(`\nSearch results for "${query}":\n`));
  for (const r of results) {
    const typeLabel = r.matchType === "topic" ? "Topic" : "Synthesis";
    console.log(theme.brand(`  [${r.sessionId}]`), r.sessionName);
    console.log(theme.dim(`    ${typeLabel}: ${r.matchSnippet}`));
  }
  console.log("");
}

function handleSessionsListCommand(sessionManager: SessionManager): void {
  const list = sessionManager.listSessions();
  if (list.length === 0) {
    console.log(theme.dim("\nNo saved sessions.\n"));
    return;
  }

  console.log(theme.bold("\nSaved sessions:\n"));
  for (let i = 0; i < list.length; i++) {
    const s = list.at(i);
    if (!s) continue;
    const timeAgo = sessionManager.formatRelativeTime(s.updatedAt);
    const label = s.name || s.topic || "Untitled";
    const displayLabel =
      label.length > 50 ? label.substring(0, 50) + "..." : label;
    const debateSuffix = s.debateCount === 1 ? "" : "s";
    console.log(
      theme.brand(`  ${i + 1}.`),
      displayLabel,
      theme.dim(`(${s.debateCount} debate${debateSuffix}, ${timeAgo})`),
    );
    if (s.preview && s.preview !== "(no synthesis)") {
      console.log(theme.dim(`     ${s.preview}`));
    }
  }
  console.log(
    theme.dim("\n  Resume with: consilium sessions resume <session-id>\n"),
  );
}

function handleRenameCommand(
  args: string[],
  session: ChatSession,
  sessionManager: SessionManager,
): void {
  const newName = args.join(" ").trim();
  if (!newName) {
    console.log(theme.warning("Usage: /rename <new name>"));
    return;
  }

  session.name = newName;

  if (session.id) {
    sessionManager.renameSession(session.id, newName);
    console.log(theme.success(`Session renamed to: ${newName}`));
  } else {
    console.log(theme.success(`Session will be saved as: ${newName}`));
  }
}

function handleDeleteCommand(
  args: string[],
  sessionManager: SessionManager,
  rl: readline.Interface,
  callback: () => void,
): void {
  const targetId = args[0];
  if (!targetId) {
    console.log(theme.warning("Usage: /delete <session-id>"));
    callback();
    return;
  }

  rl.question(
    theme.warning(`Delete session "${targetId}"? (y/N) `),
    (answer) => {
      const confirmed = answer.trim().toLowerCase() === "y";
      if (!confirmed) {
        console.log(theme.dim("Cancelled."));
        callback();
        return;
      }

      const deleted = sessionManager.deleteSession(targetId);
      if (deleted) {
        console.log(theme.success(`Session "${targetId}" deleted.`));
      } else {
        console.log(theme.error(`Session not found: ${targetId}`));
      }
      callback();
    },
  );
}

async function handleSlashCommand(
  input: string,
  session: ChatSession,
  sessionManager: SessionManager,
  rl: readline.Interface,
): Promise<"exit" | "continue" | "delete-pending"> {
  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);
  const cmd = (parts[0] ?? "").toLowerCase();
  const args = parts.slice(1);
  return dispatchSlashCommand(cmd, args, session, sessionManager, rl, {
    printHelp,
    printConversationHistory,
    handleSearchCommand,
    handleSessionsListCommand,
    handleRenameCommand,
    rerunLastDebateWithWorkspace: async () => {
      const last = session.debates.at(-1);
      if (!last?.topic) {
        console.log(
          theme.warning(
            "\nNo previous debate to redo. Ask a question first.\n",
          ),
        );
        return;
      }
      const ctx = await loadWorkspaceDebateContext({});
      if (ctx?.projectFiles.length) {
        session.projectFiles = ctx.projectFiles;
        session.contextManifest = ctx.contextManifest;
      } else {
        session.projectFiles = undefined;
        session.contextManifest = undefined;
      }
      console.log(theme.brand(`\nRe-running: ${last.topic}\n`));
      await session.debate(last.topic);
    },
  });
}

function autoSave(session: ChatSession, sessionManager: SessionManager): void {
  try {
    sessionManager.saveSession(session);
  } catch (err: unknown) {
    log("WARN", "autosave_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function pushHistory(history: string[], line: string): void {
  if (!line || history.at(-1) === line) return;
  history.push(line);
  if (history.length > INPUT_HISTORY_SIZE) history.shift();
}

async function runShellPassthrough(command: string): Promise<void> {
  if (isDangerousShellCommand(command)) {
    console.log(
      theme.error("[SHELL MODE] Blocked dangerous command: " + command),
    );
    return;
  }
  console.log(theme.brand("[SHELL MODE]"), theme.dim("$ " + command));
  const shellPath = process.env.SHELL || "/bin/sh";
  await new Promise<void>((resolve) => {
    const child = spawn(shellPath, ["-c", command], {
      stdio: ["ignore", "inherit", "inherit"],
      env: process.env,
    });
    child.on("close", (code) => {
      if (code !== 0) {
        console.log(theme.dim(`[SHELL MODE] exit ${code}`));
      }
      resolve();
    });
    child.on("error", (err) => {
      console.log(theme.error(`[SHELL MODE] error: ${err.message}`));
      resolve();
    });
  });
  console.log("");
}

interface MentionInjectionResult {
  injectedPrefix: string;
  injectedCount: number;
  skipped: string[];
}

async function buildAtMentionPrefix(
  mentions: string[],
): Promise<MentionInjectionResult> {
  if (mentions.length === 0) {
    return { injectedPrefix: "", injectedCount: 0, skipped: [] };
  }

  const limited = mentions.slice(0, MAX_AT_MENTIONS_PER_INPUT);
  const rootInfo = resolveProjectRoot(process.cwd());
  const ok = await requestCodebasePermission(rootInfo.root);
  if (!ok) {
    console.log(
      theme.warning(
        "Codebase read permission denied; @-file references were not attached.",
      ),
    );
    return { injectedPrefix: "", injectedCount: 0, skipped: limited };
  }

  const parts: string[] = [];
  const skipped: string[] = [];
  let injected = 0;

  for (const mention of limited) {
    const resolved = path.resolve(process.cwd(), mention);
    const root = rootInfo.root;
    const inScope = resolved === root || resolved.startsWith(root + path.sep);
    if (!inScope) {
      skipped.push(mention);
      continue;
    }
    if (!fs.existsSync(resolved)) {
      skipped.push(mention);
      continue;
    }
    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch {
      skipped.push(mention);
      continue;
    }
    if (!stat.isFile()) {
      skipped.push(mention);
      continue;
    }
    if (stat.size > MAX_AT_FILE_BYTES) {
      console.log(
        theme.warning(
          `@${mention} skipped: file exceeds ${Math.round(MAX_AT_FILE_BYTES / 1024)}KB limit`,
        ),
      );
      skipped.push(mention);
      continue;
    }
    let content: string;
    try {
      content = fs.readFileSync(resolved, "utf-8");
    } catch {
      skipped.push(mention);
      continue;
    }
    if (content.includes("\0")) {
      skipped.push(mention);
      continue;
    }
    const lang = inferLanguage(resolved);
    const fence = "```";
    parts.push(
      `Attached file: ${mention}\n${fence}${lang}\n${content}\n${fence}`,
    );
    injected += 1;
  }

  if (mentions.length > MAX_AT_MENTIONS_PER_INPUT) {
    console.log(
      theme.warning(
        `Only the first ${MAX_AT_MENTIONS_PER_INPUT} @-references were attached.`,
      ),
    );
  }

  const injectedPrefix = parts.length > 0 ? parts.join("\n\n") + "\n\n" : "";
  return { injectedPrefix, injectedCount: injected, skipped };
}

function inferLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "ts",
    ".tsx": "tsx",
    ".js": "js",
    ".jsx": "jsx",
    ".py": "python",
    ".rb": "ruby",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".kt": "kotlin",
    ".swift": "swift",
    ".cpp": "cpp",
    ".c": "c",
    ".h": "c",
    ".cs": "csharp",
    ".php": "php",
    ".sh": "bash",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".json": "json",
    ".md": "markdown",
    ".sql": "sql",
    ".html": "html",
    ".css": "css",
    ".scss": "scss",
  };
  return map[ext] ?? "";
}

async function tryAttachPastedImage(
  input: string,
  session: ChatSession,
): Promise<boolean> {
  const trimmed = input.trim();
  if (!trimmed) return false;

  if (isImagePath(trimmed) && !trimmed.includes(" ")) {
    try {
      const att = await attachImage(trimmed);
      session.contextManager.addImage(trimmed);
      session.contextImagePaths.push(trimmed);
      console.log(
        theme.success(`Attached image ${att.name} (${att.mimeType}).`),
      );
      return true;
    } catch (err) {
      console.log(
        theme.error(
          `Could not attach image: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      return true;
    }
  }

  if (detectImageBase64Mime(trimmed)) {
    try {
      const att = attachBase64Image(trimmed, "pasted");
      const tmpName = `${att.name}-${Date.now()}`;
      session.contextImagePaths.push(tmpName);
      console.log(theme.success(`Attached pasted ${att.mimeType} image.`));
      return true;
    } catch (err) {
      console.log(
        theme.error(
          `Could not decode pasted image: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      return true;
    }
  }

  return false;
}

function installModeCycleKeybinding(rl: readline.Interface): void {
  if (!process.stdin.isTTY) return;
  try {
    readline.emitKeypressEvents(process.stdin, rl);
  } catch {
    return;
  }
  process.stdin.on("keypress", (_str, key) => {
    if (!key) return;
    if (key.shift && key.name === "tab") {
      const next = cycleMode();
      process.stdout.write(`\n[mode] ${next} - ${describeMode(next)}\n`);
      const session = currentSessionRef;
      rl.setPrompt(session ? getPrompt(session) : DEFAULT_PROMPT);
      rl.prompt(true);
    }
  });
}

function installVimKeybindings(rl: readline.Interface): void {
  if (!vimState.enabled) return;
  if (!process.stdin.isTTY) return;

  try {
    readline.emitKeypressEvents(process.stdin);
    if (typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(true);
    }
  } catch {
    return;
  }

  process.stdin.on("keypress", (_str, key) => {
    if (!key) return;
    if (key.ctrl && key.name === "c") {
      rl.close();
      return;
    }
    if (key.name === "escape") {
      if (vimState.mode !== "NORMAL") {
        vimState.mode = "NORMAL";
        rl.setPrompt(getPromptForCurrentSession() || DEFAULT_PROMPT);
        rl.prompt(true);
      }
      vimState.pendingKey = null;
      return;
    }
    if (vimState.mode === "NORMAL") {
      handleVimNormalKey(key, rl);
    }
  });
}

let currentSessionRef: ChatSession | null = null;

function getPromptForCurrentSession(): string | null {
  if (!currentSessionRef) return null;
  return getPrompt(currentSessionRef);
}

function handleVimNormalKey(
  key: { name?: string; sequence?: string },
  rl: readline.Interface,
): void {
  const name = key.name ?? "";
  if (name === "i" || name === "a") {
    vimState.mode = "INSERT";
    vimState.pendingKey = null;
    rl.setPrompt(getPromptForCurrentSession() || DEFAULT_PROMPT);
    rl.prompt(true);
    return;
  }
  if (name === "d") {
    if (vimState.pendingKey === "d") {
      (rl as unknown as { line?: string }).line = "";
      (rl as unknown as { cursor?: number }).cursor = 0;
      rl.setPrompt(getPromptForCurrentSession() || DEFAULT_PROMPT);
      rl.prompt(true);
      vimState.pendingKey = null;
      return;
    }
    vimState.pendingKey = "d";
    return;
  }
  if (name === "colon" || key.sequence === ":") {
    vimState.pendingKey = ":";
    return;
  }
  if (vimState.pendingKey === ":" && name === "q") {
    rl.close();
    return;
  }
  if (name === "k") {
    process.stdout.write("\x1b[A");
    vimState.pendingKey = null;
    return;
  }
  if (name === "j") {
    process.stdout.write("\x1b[B");
    vimState.pendingKey = null;
    return;
  }
  if (name === "h") {
    process.stdout.write("\x1b[D");
    vimState.pendingKey = null;
    return;
  }
  if (name === "l") {
    process.stdout.write("\x1b[C");
    vimState.pendingKey = null;
    return;
  }
  vimState.pendingKey = null;
}

function runReplLoop(
  rl: readline.Interface,
  history: string[],
  session: ChatSession,
  sessionManager: SessionManager,
): void {
  currentSessionRef = session;
  rl.question(getPrompt(session), (line) => {
    const raw = line || "";
    const trimmed = raw.trim();
    if (!trimmed) {
      runReplLoop(rl, history, session, sessionManager);
      return;
    }

    pushHistory(history, trimmed);

    void safeRunHooks("UserPromptSubmit", {
      prompt: trimmed,
      sessionId: session.id ?? null,
    }).then((hookResults) => {
      if (shouldBlock(hookResults)) {
        console.error(
          theme.warning("[hooks] UserPromptSubmit blocked this input"),
        );
        runReplLoop(rl, history, session, sessionManager);
        return;
      }
      handleReplInput(trimmed, rl, history, session, sessionManager);
    });
  });
}

function handleReplInput(
  trimmed: string,
  rl: readline.Interface,
  history: string[],
  session: ChatSession,
  sessionManager: SessionManager,
): void {
  if (isShellPassthrough(trimmed)) {
    const cmd = extractShellCommand(trimmed);
    if (!cmd) {
      console.log(theme.warning("[SHELL MODE] Empty command"));
      runReplLoop(rl, history, session, sessionManager);
      return;
    }
    runShellPassthrough(cmd).then(() => {
      runReplLoop(rl, history, session, sessionManager);
    });
    return;
  }

  if (trimmed.toLowerCase().startsWith("/ask")) {
    const topic = trimmed.slice(4).trim();
    if (!topic) {
      console.log(theme.warning("Usage: /ask <topic>"));
      runReplLoop(rl, history, session, sessionManager);
      return;
    }
    runDebateWithMentions(topic, session, sessionManager, rl, history);
    return;
  }

  if (trimmed === "/") {
    printHelp();
    runReplLoop(rl, history, session, sessionManager);
    return;
  }

  if (trimmed.startsWith("/")) {
    if (trimmed.toLowerCase().startsWith("/delete")) {
      const parts = trimmed.split(/\s+/);
      const deleteArgs = parts.slice(1);
      if (!deleteArgs[0]) {
        console.log(theme.warning("Usage: /delete <session-id>"));
        runReplLoop(rl, history, session, sessionManager);
        return;
      }
      handleDeleteCommand(deleteArgs, sessionManager, rl, () => {
        runReplLoop(rl, history, session, sessionManager);
      });
      return;
    }

    handleSlashCommand(trimmed, session, sessionManager, rl).then((result) => {
      if (result === "exit") {
        rl.close();
        return;
      }
      runReplLoop(rl, history, session, sessionManager);
    });
    return;
  }

  tryAttachPastedImage(trimmed, session).then((wasImage) => {
    if (wasImage) {
      runReplLoop(rl, history, session, sessionManager);
      return;
    }
    runDebateWithMentions(trimmed, session, sessionManager, rl, history);
  });
}

function runDebateWithMentions(
  topic: string,
  session: ChatSession,
  sessionManager: SessionManager,
  rl: readline.Interface,
  history: string[],
): void {
  const parsed = parseAtMentions(topic);
  const continueAfter = () => runReplLoop(rl, history, session, sessionManager);

  buildAtMentionPrefix(parsed.mentions)
    .then(({ injectedPrefix, injectedCount }) => {
      if (injectedCount > 0) {
        console.log(
          theme.dim(`Attached ${injectedCount} file(s) from @-references.`),
        );
      }
      const effective = injectedPrefix + (parsed.cleanedInput || topic);
      return session.debate(effective);
    })
    .then(
      () => {
        autoSave(session, sessionManager);
        continueAfter();
      },
      (error: any) => {
        console.error(theme.error("\nDebate failed:"), error.message);
        if (
          typeof error.message === "string" &&
          error.message.includes("503")
        ) {
          console.log(
            theme.warning(
              "Suggestion: Make sure the agents service is running:",
            ),
          );
          console.log(
            theme.dim(
              "   cd apps/agents && poetry run uvicorn src.main:app --reload --port 8000",
            ),
          );
        } else if (
          typeof error.message === "string" &&
          (error.message.includes("context size") ||
            error.message.includes("Total context"))
        ) {
          console.log(
            theme.warning(
              "Suggestion: Try /clear to remove files, or use smaller files.",
            ),
          );
        }
        console.log(
          theme.dim("Continuing... type /help or ask something else.\n"),
        );
        continueAfter();
      },
    );
}

export async function chatCommand(): Promise<void> {
  await requireAuth();

  const client = new ConsiliumClient();
  const contextManager = new ContextManager();
  const session = new ChatSession(client, contextManager);
  const sessionManager = new SessionManager(DEFAULT_SESSION_DIR);

  const sessionStartResults = await safeRunHooks("SessionStart", {
    sessionId: session.id ?? null,
    cwd: process.cwd(),
  });
  if (shouldBlock(sessionStartResults)) {
    console.error(theme.error("[hooks] SessionStart blocked startup"));
    return;
  }

  const spinner = ora("Checking API connection...").start();
  const isHealthy = await client.healthCheck();

  if (!isHealthy) {
    spinner.fail("API is not available");
    process.exit(1);
  }
  spinner.succeed("Connected");

  log("INFO", "session_started", { sessionId: session.id });

  printWelcome();
  const config = loadConfig();
  const baseUrl = config.apiUrl || DEFAULT_API_ORIGIN;
  try {
    const host = new URL(baseUrl).host;
    console.log(theme.dim("Ready. Connected to " + host));
  } catch {
    console.log(theme.dim("Ready. Connected."));
  }

  try {
    const projectMemory = loadMemory(process.cwd());
    if (projectMemory && projectMemory.notes.length > 0) {
      console.log(
        theme.dim(
          `Loaded ${projectMemory.notes.length} memory note(s) from this project. View with /memory.`,
        ),
      );
    }
  } catch {
    // best-effort load; never block startup
  }

  if (vimState.enabled) {
    console.log(
      theme.dim("Vim mode enabled (Esc: NORMAL, i: INSERT, :q to quit)"),
    );
  }

  const wsContext = await loadWorkspaceDebateContext({});
  if (wsContext?.projectFiles.length) {
    session.projectFiles = wsContext.projectFiles;
    session.contextManifest = wsContext.contextManifest;
    console.log(
      theme.dim(
        `Prepared ${wsContext.projectFiles.length} scanned project file(s) for debates.`,
      ),
    );
  } else {
    session.projectFiles = undefined;
    session.contextManifest = undefined;
  }
  console.log("");

  const SLASH_COMMANDS = [
    "/ask",
    "/mode",
    "/estimate",
    "/output",
    "/file",
    "/image",
    "/workspace",
    "/context",
    "/clear",
    "/status",
    "/manifest",
    "/models",
    "/save",
    "/history",
    "/sessions",
    "/search",
    "/api",
    "/keys",
    "/codebase",
    "/permissions",
    "/apply",
    "/rollback",
    "/review",
    "/scope",
    "/gitdiff",
    "/help",
    "/exit",
    "/new",
    "/rename",
    "/delete",
    "/redo",
    "/tui",
    "/insights",
    "/team-onboarding",
    "/memory",
  ];

  function completer(line: string): [string[], string] {
    if (line.startsWith("/")) {
      const hits = SLASH_COMMANDS.filter((c) => c.startsWith(line));
      return [hits.length ? hits : SLASH_COMMANDS, line];
    }
    return [[], line];
  }

  const history: string[] = [];
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: DEFAULT_PROMPT,
    history,
    historySize: INPUT_HISTORY_SIZE,
    removeHistoryDuplicates: true,
    completer,
    terminal: vimState.enabled ? true : undefined,
  });

  installVimKeybindings(rl);
  installModeCycleKeybinding(rl);

  await new Promise<void>((resolve) => {
    rl.on("close", () => {
      const tui = getTUI();
      if (tui.isActive()) tui.leave();
      void safeRunHooks("Stop", {
        sessionId: session.id ?? null,
        reason: "normal",
      }).finally(() => resolve());
    });
    runReplLoop(rl, history, session, sessionManager);
  });
}

export async function chatResumeCommand(sessionId: string): Promise<void> {
  await requireAuth();

  const sessionManager = new SessionManager(DEFAULT_SESSION_DIR);

  try {
    const session = sessionManager.loadSession(sessionId);
    const displayName = session.name || sessionId;

    console.log(theme.success(`\nResuming session: ${displayName}\n`));

    if (session.debates.length > 0) {
      console.log(theme.bold("Conversation history:"));
      session.debates.forEach((d, i) => {
        const topicPreview =
          d.topic.length > 60 ? d.topic.substring(0, 60) + "..." : d.topic;
        console.log(theme.brand(`  ${i + 1}.`), topicPreview);
      });
      const loadedSuffix = session.debates.length === 1 ? "" : "s";
      console.log(
        theme.dim(
          `\n  ${session.debates.length} debate${loadedSuffix} loaded. Previous syntheses will be used as context.\n`,
        ),
      );
    }

    printWelcome();

    const history: string[] = [];
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: DEFAULT_PROMPT,
      history,
      historySize: INPUT_HISTORY_SIZE,
      removeHistoryDuplicates: true,
      terminal: vimState.enabled ? true : undefined,
    });

    installVimKeybindings(rl);
    installModeCycleKeybinding(rl);
    runReplLoop(rl, history, session, sessionManager);
  } catch (error: any) {
    console.error(theme.error("Failed to load session:"), error.message);
    process.exit(1);
  }
}
