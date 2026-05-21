import readline from "node:readline";
import path from "node:path";
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

const DEFAULT_SESSION_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || "",
  ".consilium",
  "sessions",
);

const st = style();
const w = terminal.width;
const DEFAULT_PROMPT = "consilium > ";
const INPUT_HISTORY_SIZE = 100;

function getPrompt(session: ChatSession): string {
  return formatPrompt({ fileCount: session.contextFilePaths.length }) + " ";
}

function printWelcome(): void {
  console.log(st.dim("\n" + border("Consilium", w)));
  console.log(contentLine("  Multi-Agent Debate Platform", w));
  console.log(contentLine("", w));
  console.log(contentLine("  Type your question to start a debate", w));
  console.log(
    contentLine(
      "  Use / for commands  •  ↑↓ for history  •  Ctrl+C to exit",
      w,
    ),
  );
  console.log(contentLine("", w));
  console.log(st.dim(borderBottom(w)) + "\n");
}

function printHelp(): void {
  console.log(st.bold("\nCommands:\n"));
  console.log(st.bold("  Debate"));
  console.log(
    st.dim("  /ask <topic>    - Run one debate (same as typing the topic)"),
  );
  console.log(
    st.dim("  /mode [mode]    - Set debate mode: quick, council, deep, blind"),
  );
  console.log(st.dim("  /estimate       - Show cost estimate for next debate"));
  console.log(
    st.dim(
      "  /output [fmt]   - Set output format: markdown, cursorrules, claude-md, json, text",
    ),
  );
  console.log(st.bold("\n  Context"));
  console.log(
    st.dim(
      "  /file <path>    - Add file to context (max 100KB per file, 500KB total)",
    ),
  );
  console.log(st.dim("  /image <path>   - Add image to context"));
  console.log(
    st.dim("  /workspace      - Detect project and show workspace info"),
  );
  console.log(
    st.dim("  /context        - Show context window usage and token budget"),
  );
  console.log(st.dim("  /clear          - Clear context"));
  console.log(st.bold("\n  Session"));
  console.log(st.dim("  /status         - Show session status"));
  console.log(
    st.dim(
      "  /manifest       - Show workspace context manifest (loaded/skipped files)",
    ),
  );
  console.log(
    st.dim("  /models [m1 ..] - Set models; no args to show current"),
  );
  console.log(
    st.dim("  /save [file]    - Save synthesis to file, or session to disk"),
  );
  console.log(st.dim("  /history        - Show conversation history"));
  console.log(st.dim("  /conversations  - List recent conversations"));
  console.log(st.dim("  /new            - Start a new conversation"));
  console.log(st.dim("  /sessions       - List all saved sessions"));
  console.log(st.dim("  /resume <id>    - Resume a saved session"));
  console.log(st.dim("  /search <query> - Search across all conversations"));
  console.log(st.dim("  /rename <name>  - Rename current session"));
  console.log(st.dim("  /delete <id>    - Delete a saved session"));
  console.log(st.bold("\n  Config"));
  console.log(
    st.dim(
      "  /api            - Show API key status; /api set <key> or /api open",
    ),
  );
  console.log(
    st.dim("  /keys [open|status] - Provider LLM keys page or account status"),
  );
  console.log(st.dim("  /track, /insights - Open web analytics (usage)"));
  console.log(
    st.dim(
      "  /codebase       - allow | status | revoke local file read for debates",
    ),
  );
  console.log(
    st.dim(
      "  /permissions    - status | allow-write | revoke-write for read/write policy",
    ),
  );
  console.log(
    st.dim(
      "  /apply          - Apply structured edits from latest synthesis (preview + permission gated)",
    ),
  );
  console.log(
    st.dim(
      "  /redo, /again   - Re-run last topic with current workspace permission and files",
    ),
  );
  console.log(st.dim("  /help           - Show this help"));
  console.log(st.dim("  /exit           - Exit and save session"));
  console.log(st.dim("\n  ↑/↓ - Input history\n"));
}

function printConversationHistory(session: ChatSession): void {
  if (session.debates.length === 0) {
    console.log(st.dim("\nNo debates in this session yet.\n"));
    return;
  }

  console.log(st.bold("\nConversation History:\n"));
  let historyIndex = 0;
  for (const d of session.debates) {
    historyIndex += 1;
    const topicPreview =
      d.topic.length > 70 ? d.topic.substring(0, 70) + "..." : d.topic;
    const time = d.timestamp
      ? st.dim(` (${new Date(d.timestamp).toLocaleString()})`)
      : "";
    console.log(st.brand(`  ${historyIndex}.`), topicPreview + time);

    if (d.goldenPrompt) {
      const synthPreview =
        d.goldenPrompt.length > 100
          ? d.goldenPrompt.substring(0, 100) + "..."
          : d.goldenPrompt;
      console.log(st.dim(`     Synthesis: ${synthPreview}`));
    }
  }
  console.log("");
}

function handleSearchCommand(
  query: string,
  sessionManager: SessionManager,
): void {
  if (!query) {
    console.log(st.warning("Usage: /search <query>"));
    return;
  }

  const results = sessionManager.searchSessions(query);
  if (results.length === 0) {
    console.log(st.dim(`\nNo results for "${query}".\n`));
    return;
  }

  console.log(st.bold(`\nSearch results for "${query}":\n`));
  for (const r of results) {
    const typeLabel = r.matchType === "topic" ? "Topic" : "Synthesis";
    console.log(st.brand(`  [${r.sessionId}]`), r.sessionName);
    console.log(st.dim(`    ${typeLabel}: ${r.matchSnippet}`));
  }
  console.log("");
}

function handleSessionsListCommand(sessionManager: SessionManager): void {
  const list = sessionManager.listSessions();
  if (list.length === 0) {
    console.log(st.dim("\nNo saved sessions.\n"));
    return;
  }

  console.log(st.bold("\nSaved sessions:\n"));
  for (let i = 0; i < list.length; i++) {
    const s = list.at(i);
    if (!s) continue;
    const timeAgo = sessionManager.formatRelativeTime(s.updatedAt);
    const label = s.name || s.topic || "Untitled";
    const displayLabel =
      label.length > 50 ? label.substring(0, 50) + "..." : label;
    const debateSuffix = s.debateCount === 1 ? "" : "s";
    console.log(
      st.brand(`  ${i + 1}.`),
      displayLabel,
      st.dim(`(${s.debateCount} debate${debateSuffix}, ${timeAgo})`),
    );
    if (s.preview && s.preview !== "(no synthesis)") {
      console.log(st.dim(`     ${s.preview}`));
    }
  }
  console.log(
    st.dim("\n  Resume with: consilium sessions resume <session-id>\n"),
  );
}

function handleRenameCommand(
  args: string[],
  session: ChatSession,
  sessionManager: SessionManager,
): void {
  const newName = args.join(" ").trim();
  if (!newName) {
    console.log(st.warning("Usage: /rename <new name>"));
    return;
  }

  session.name = newName;

  if (session.id) {
    sessionManager.renameSession(session.id, newName);
    console.log(st.success(`Session renamed to: ${newName}`));
  } else {
    console.log(st.success(`Session will be saved as: ${newName}`));
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
    console.log(st.warning("Usage: /delete <session-id>"));
    callback();
    return;
  }

  rl.question(st.warning(`Delete session "${targetId}"? (y/N) `), (answer) => {
    const confirmed = answer.trim().toLowerCase() === "y";
    if (!confirmed) {
      console.log(st.dim("Cancelled."));
      callback();
      return;
    }

    const deleted = sessionManager.deleteSession(targetId);
    if (deleted) {
      console.log(st.success(`Session "${targetId}" deleted.`));
    } else {
      console.log(st.error(`Session not found: ${targetId}`));
    }
    callback();
  });
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
          st.warning("\nNo previous debate to redo. Ask a question first.\n"),
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
      console.log(st.brand(`\nRe-running: ${last.topic}\n`));
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

function runReplLoop(
  rl: readline.Interface,
  history: string[],
  session: ChatSession,
  sessionManager: SessionManager,
): void {
  rl.question(getPrompt(session), (line) => {
    const trimmed = (line || "").trim();
    if (!trimmed) {
      runReplLoop(rl, history, session, sessionManager);
      return;
    }

    pushHistory(history, trimmed);

    if (trimmed.toLowerCase().startsWith("/ask")) {
      const topic = trimmed.slice(4).trim();
      if (!topic) {
        console.log(st.warning("Usage: /ask <topic>"));
        runReplLoop(rl, history, session, sessionManager);
        return;
      }
      session.debate(topic).then(
        () => {
          autoSave(session, sessionManager);
          runReplLoop(rl, history, session, sessionManager);
        },
        (error: any) => {
          console.error(st.error("\nDebate failed:"), error.message);
          if (error.message.includes("503")) {
            console.log(
              st.warning(
                "Suggestion: Make sure the agents service is running.",
              ),
            );
            console.log(
              st.dim(
                "   cd apps/agents && poetry run uvicorn src.main:app --reload --port 8000",
              ),
            );
          }
          console.log(
            st.dim("Continuing... type /help or ask something else.\n"),
          );
          runReplLoop(rl, history, session, sessionManager);
        },
      );
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
          console.log(st.warning("Usage: /delete <session-id>"));
          runReplLoop(rl, history, session, sessionManager);
          return;
        }
        handleDeleteCommand(deleteArgs, sessionManager, rl, () => {
          runReplLoop(rl, history, session, sessionManager);
        });
        return;
      }

      handleSlashCommand(trimmed, session, sessionManager, rl).then(
        (result) => {
          if (result === "exit") {
            rl.close();
            return;
          }
          runReplLoop(rl, history, session, sessionManager);
        },
      );
      return;
    }

    session.debate(trimmed).then(
      () => {
        autoSave(session, sessionManager);
        runReplLoop(rl, history, session, sessionManager);
      },
      (error: any) => {
        console.error(st.error("\nDebate failed:"), error.message);
        if (error.message.includes("503")) {
          console.log(
            st.warning("Suggestion: Make sure the agents service is running:"),
          );
          console.log(
            st.dim(
              "   cd apps/agents && poetry run uvicorn src.main:app --reload --port 8000",
            ),
          );
        } else if (
          error.message.includes("context size") ||
          error.message.includes("Total context")
        ) {
          console.log(
            st.warning(
              "Suggestion: Try /clear to remove files, or use smaller files.",
            ),
          );
        }
        console.log(
          st.dim("Continuing... type /help or ask something else.\n"),
        );
        runReplLoop(rl, history, session, sessionManager);
      },
    );
  });
}

export async function chatCommand(): Promise<void> {
  await requireAuth();

  const client = new ConsiliumClient();
  const contextManager = new ContextManager();
  const session = new ChatSession(client, contextManager);
  const sessionManager = new SessionManager(DEFAULT_SESSION_DIR);

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
    console.log(st.dim("Ready. Connected to " + host));
  } catch {
    console.log(st.dim("Ready. Connected."));
  }

  const wsContext = await loadWorkspaceDebateContext({});
  if (wsContext?.projectFiles.length) {
    session.projectFiles = wsContext.projectFiles;
    session.contextManifest = wsContext.contextManifest;
    console.log(
      st.dim(
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
  });
  await new Promise<void>((resolve) => {
    rl.on("close", resolve);
    runReplLoop(rl, history, session, sessionManager);
  });
}

export async function chatResumeCommand(sessionId: string): Promise<void> {
  await requireAuth();

  const sessionManager = new SessionManager(DEFAULT_SESSION_DIR);

  try {
    const session = sessionManager.loadSession(sessionId);
    const displayName = session.name || sessionId;

    console.log(st.success(`\nResuming session: ${displayName}\n`));

    if (session.debates.length > 0) {
      console.log(st.bold("Conversation history:"));
      session.debates.forEach((d, i) => {
        const topicPreview =
          d.topic.length > 60 ? d.topic.substring(0, 60) + "..." : d.topic;
        console.log(st.brand(`  ${i + 1}.`), topicPreview);
      });
      const loadedSuffix = session.debates.length === 1 ? "" : "s";
      console.log(
        st.dim(
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
    });
    runReplLoop(rl, history, session, sessionManager);
  } catch (error: any) {
    console.error(st.error("Failed to load session:"), error.message);
    process.exit(1);
  }
}
