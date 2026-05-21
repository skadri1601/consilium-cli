import { DEBATE_MODES, type DebateMode } from "@consilium/shared";
import type { ToolResult } from "../tools/builtin-tools.js";

export type SlashRunResult = {
  exit?: boolean;
  cleared?: boolean;
};

async function logToolResult(result: ToolResult): Promise<void> {
  const { style } = await import("../utils/visual-system.js");
  const st = style();
  const text = result.content[0]?.text ?? "";
  if (result.isError) console.log(st.error(text));
  else console.log(text);
}

async function logUsage(message: string): Promise<void> {
  const { default: chalk } = await import("chalk");
  console.log(chalk.hex("#9ca3af")(message));
}

/**
 * Parse `/grep` arguments. Honours simple double quotes so the pattern can
 * legitimately contain spaces or end in a wildcard without being eaten by a
 * trailing-glob heuristic.
 */
function parseGrepArgs(rawArgs: string): { pattern: string; glob?: string } {
  const trimmed = rawArgs.trim();
  if (!trimmed) return { pattern: "" };

  // Tokenize while respecting "..." quoting.
  const tokens: string[] = [];
  const tokenRe = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(trimmed)) !== null) {
    tokens.push(m[1] ?? m[2] ?? "");
  }
  if (tokens.length === 0) return { pattern: "" };

  const [pattern, ...rest] = tokens;
  const glob = rest.length > 0 ? rest.join(" ") : undefined;
  return { pattern: pattern ?? "", glob };
}

export interface SlashCommand {
  name: string;
  category: "mode" | "session" | "config" | "system";
  summary: string;
  usage?: string;
  hint?: string;
  run: (rawArgs: string) => Promise<SlashRunResult | void>;
}

function modeHint(mode: DebateMode): string {
  const cfg = DEBATE_MODES[mode];
  return `${cfg.description} (${cfg.estimatedTime})`;
}

async function runDebate(topic: string, mode: DebateMode): Promise<void> {
  const trimmed = topic.trim();
  if (!trimmed) {
    const { default: chalk } = await import("chalk");
    console.log(
      chalk.hex("#9ca3af")(`(no topic provided - usage: /${mode} <topic>)`),
    );
    return;
  }
  if (mode === "redteam") {
    const { redteamCommand } = await import("../commands/redteam.js");
    await redteamCommand(trimmed, {});
    return;
  }
  const { debateCommand } = await import("../commands/debate.js");
  await debateCommand(trimmed, { mode });
}

const MODE_ORDER: DebateMode[] = [
  "auto",
  "quick",
  "council",
  "deep",
  "blind",
  "redteam",
  "jury",
  "market",
];

const modeCommands: SlashCommand[] = MODE_ORDER.map((mode) => ({
  name: mode,
  category: "mode",
  summary: modeHint(mode),
  usage: `/${mode} <topic>`,
  run: async (rawArgs) => {
    await runDebate(rawArgs, mode);
  },
}));

const utilityCommands: SlashCommand[] = [
  {
    name: "ask",
    category: "mode",
    summary: "Ask the council a question (alias for /auto)",
    usage: "/ask <topic>",
    run: async (rawArgs) => {
      await runDebate(rawArgs, "auto");
    },
  },
  {
    name: "chat",
    category: "session",
    summary: "Start an interactive multi-agent chat session",
    usage: "/chat",
    run: async () => {
      const { chatCommand } = await import("../commands/chat.js");
      await chatCommand();
    },
  },
  {
    name: "eval",
    category: "mode",
    summary: "Run a blind evaluation of model responses",
    usage: "/eval <topic>",
    run: async (rawArgs) => {
      const trimmed = rawArgs.trim();
      if (!trimmed) {
        const { default: chalk } = await import("chalk");
        console.log(
          chalk.hex("#9ca3af")("(no topic provided - usage: /eval <topic>)"),
        );
        return;
      }
      const { evalCommand } = await import("../commands/eval.js");
      await evalCommand(trimmed, {});
    },
  },
  {
    name: "stats",
    category: "session",
    summary: "Show model performance dashboard",
    usage: "/stats",
    run: async () => {
      const { statsCommand } = await import("../commands/stats.js");
      await statsCommand();
    },
  },
  {
    name: "debates",
    category: "session",
    summary: "List your recent debate sessions",
    usage: "/debates [search]",
    run: async (rawArgs) => {
      const { listDebatesCommand } = await import("../commands/debates.js");
      const search = rawArgs.trim();
      await listDebatesCommand(search ? { search } : {});
    },
  },
  {
    name: "debate-pr",
    category: "mode",
    summary: "Fetch a GitHub PR via gh and have the council review it",
    usage: "/debate-pr <number-or-url>",
    run: async (rawArgs) => {
      const ref = rawArgs.trim();
      if (!ref) {
        const { default: chalk } = await import("chalk");
        console.log(chalk.hex("#9ca3af")("Usage: /debate-pr <number-or-url>"));
        return;
      }
      const { debatePrCommand } =
        await import("../commands/debate-shortcuts.js");
      await debatePrCommand(ref, {});
    },
  },
  {
    name: "debate-issue",
    category: "mode",
    summary: "Debate a GitHub issue or Linear ticket as an implementation plan",
    usage: "/debate-issue <number-or-MYC-id>",
    run: async (rawArgs) => {
      const ref = rawArgs.trim();
      if (!ref) {
        const { default: chalk } = await import("chalk");
        console.log(
          chalk.hex("#9ca3af")("Usage: /debate-issue <number-or-MYC-id>"),
        );
        return;
      }
      const { debateIssueCommand } =
        await import("../commands/debate-shortcuts.js");
      await debateIssueCommand(ref, {});
    },
  },
  {
    name: "debate-failing",
    category: "mode",
    summary: "Run tests, debate any failure",
    usage: "/debate-failing [test-command]",
    run: async (rawArgs) => {
      const cmd = rawArgs.trim() || undefined;
      const { debateFailingCommand } =
        await import("../commands/debate-shortcuts.js");
      await debateFailingCommand(cmd ? { command: cmd } : {});
    },
  },
  {
    name: "debate-staged",
    category: "mode",
    summary: "Review the currently-staged git changes before commit",
    usage: "/debate-staged",
    run: async () => {
      const { debateStagedCommand } =
        await import("../commands/debate-shortcuts.js");
      await debateStagedCommand({});
    },
  },
  {
    name: "debug",
    category: "session",
    summary: "Show full debug trace for a debate",
    usage: "/debug <debateId>",
    run: async (rawArgs) => {
      const id = rawArgs.trim();
      if (!id) {
        const { default: chalk } = await import("chalk");
        console.log(
          chalk.hex("#9ca3af")("(no debate id - usage: /debug <debateId>)"),
        );
        return;
      }
      const { debugCommand } = await import("../commands/debug.js");
      await debugCommand(id);
    },
  },
  {
    name: "logs",
    category: "session",
    summary: "Query logs for a debate",
    usage: "/logs <debateId>",
    run: async (rawArgs) => {
      const id = rawArgs.trim();
      if (!id) {
        const { default: chalk } = await import("chalk");
        console.log(
          chalk.hex("#9ca3af")("(no debate id - usage: /logs <debateId>)"),
        );
        return;
      }
      const { logsCommand } = await import("../commands/logs.js");
      await logsCommand(id, {});
    },
  },
  {
    name: "config",
    category: "config",
    summary:
      "Manage CLI config: list / get <key> / set <key> <val> / open (browser)",
    usage: "/config [list|get <key>|set <key> <val>|open]",
    run: async (rawArgs) => {
      const args = rawArgs.trim().split(/\s+/).filter(Boolean);
      const sub = args[0] ?? "open";
      if (sub === "list") {
        const { configListCommand } = await import("../commands/config.js");
        configListCommand();
        return;
      }
      if (sub === "get") {
        const key = args[1];
        if (!key) {
          const { default: chalk } = await import("chalk");
          console.log(chalk.hex("#9ca3af")("Usage: /config get <key>"));
          return;
        }
        const { configGetCommand } = await import("../commands/config.js");
        configGetCommand(key);
        return;
      }
      if (sub === "set") {
        const key = args[1];
        const value = args.slice(2).join(" ");
        if (!key || !value) {
          const { default: chalk } = await import("chalk");
          console.log(chalk.hex("#9ca3af")("Usage: /config set <key> <value>"));
          return;
        }
        const { configSetCommand } = await import("../commands/config.js");
        configSetCommand(key, value);
        return;
      }
      if (sub === "open") {
        const { loadConfig, DEFAULT_WEB_ORIGIN } =
          await import("../utils/config.js");
        const { openBrowser } = await import("../utils/open-browser.js");
        const { style } = await import("../utils/visual-system.js");
        const cfg = loadConfig();
        const webUrl = cfg.webUrl || DEFAULT_WEB_ORIGIN;
        openBrowser(`${webUrl}/settings#api-keys`);
        console.log(style().success("Opened settings in browser"));
        return;
      }
      const { default: chalk } = await import("chalk");
      console.log(
        chalk.hex("#9ca3af")(
          `Unknown /config subcommand "${sub}". Try /config list|get|set|open.`,
        ),
      );
    },
  },
  {
    name: "mcp",
    category: "config",
    summary:
      "Print MCP setup snippet for Cursor / Python clients (alias for /integrations help)",
    usage: "/mcp",
    run: async () => {
      const { mcpCommand } = await import("../commands/mcp.js");
      await mcpCommand({});
    },
  },
  {
    name: "integrations",
    category: "config",
    summary:
      "Manage MCP servers (file readers, GitHub, etc.): list / add / remove / test / tools",
    usage:
      "/integrations [list|add <name> <cmd> [args...]|remove <name>|test <name>|tools]",
    run: async (rawArgs) => {
      const args = rawArgs.trim().split(/\s+/).filter(Boolean);
      const sub = args[0] ?? "list";
      if (sub === "list") {
        const { listServersCommand } =
          await import("../commands/mcp-servers.js");
        listServersCommand();
        return;
      }
      if (sub === "tools") {
        const { toolsCommand } = await import("../commands/mcp-servers.js");
        await toolsCommand();
        return;
      }
      if (sub === "add") {
        const name = args[1];
        const command = args[2];
        const cmdArgs = args.slice(3);
        if (!name || !command) {
          const { default: chalk } = await import("chalk");
          console.log(
            chalk.hex("#9ca3af")(
              "Usage: /integrations add <name> <command> [args...]",
            ),
          );
          console.log(
            chalk.hex("#9ca3af")(
              "Example: /integrations add filesystem npx @modelcontextprotocol/server-filesystem /home/me/code",
            ),
          );
          return;
        }
        const { addServerCommand } = await import("../commands/mcp-servers.js");
        addServerCommand(
          name,
          command,
          cmdArgs.length > 0 ? cmdArgs : undefined,
          {},
        );
        return;
      }
      if (sub === "remove") {
        const name = args[1];
        if (!name) {
          const { default: chalk } = await import("chalk");
          console.log(
            chalk.hex("#9ca3af")("Usage: /integrations remove <name>"),
          );
          return;
        }
        const { removeServerCommand } =
          await import("../commands/mcp-servers.js");
        removeServerCommand(name);
        return;
      }
      if (sub === "test") {
        const name = args[1];
        if (!name) {
          const { default: chalk } = await import("chalk");
          console.log(chalk.hex("#9ca3af")("Usage: /integrations test <name>"));
          return;
        }
        const { testServerCommand } =
          await import("../commands/mcp-servers.js");
        await testServerCommand(name);
        return;
      }
      const { default: chalk } = await import("chalk");
      console.log(
        chalk.hex("#9ca3af")(
          `Unknown /integrations subcommand "${sub}". Try /integrations list|add|remove|test|tools.`,
        ),
      );
    },
  },
  {
    name: "models",
    category: "config",
    summary: "Show available model catalog and pricing tiers",
    usage: "/models",
    run: async () => {
      const { modelsCommand } = await import("../commands/models.js");
      modelsCommand({});
    },
  },
  {
    name: "sessions",
    category: "session",
    summary:
      "Manage saved chat sessions: list / resume <id> / rename <id> <name> / delete <id>",
    usage: "/sessions [list|resume <id>|rename <id> <name>|delete <id>]",
    run: async (rawArgs) => {
      const args = rawArgs.trim().split(/\s+/).filter(Boolean);
      const sub = args[0] ?? "list";
      const { SessionManager } = await import("../utils/session-manager.js");
      const { style } = await import("../utils/visual-system.js");
      const st = style();
      const sm = new SessionManager();

      if (sub === "list") {
        const sessions = sm.listSessions();
        if (sessions.length === 0) {
          console.log(st.dim("\n  No saved sessions.\n"));
          return;
        }
        console.log(
          st.bold(
            `\n  ${sessions.length} saved session${sessions.length === 1 ? "" : "s"}\n`,
          ),
        );
        for (let i = 0; i < Math.min(sessions.length, 20); i++) {
          const s = sessions[i]!;
          const ago = sm.formatRelativeTime(s.updatedAt);
          const label = s.name || s.topic || "Untitled";
          const display =
            label.length > 60 ? label.slice(0, 57) + "..." : label;
          console.log(
            `  ${st.brand((i + 1).toString().padStart(2))}. ${display}`,
          );
          console.log(
            st.dim(
              `      ${s.id} · ${s.debateCount} debate${s.debateCount === 1 ? "" : "s"} · ${ago}`,
            ),
          );
        }
        console.log("");
        return;
      }
      if (sub === "resume") {
        const id = args[1];
        if (!id) {
          console.log(st.warning("Usage: /sessions resume <id>"));
          return;
        }
        const { chatResumeCommand } = await import("../commands/chat.js");
        await chatResumeCommand(id);
        return;
      }
      if (sub === "rename") {
        const id = args[1];
        const name = args.slice(2).join(" ").trim();
        if (!id || !name) {
          console.log(st.warning("Usage: /sessions rename <id> <new name>"));
          return;
        }
        const ok = sm.renameSession(id, name);
        if (ok) {
          console.log(st.success(`Renamed session ${id} to "${name}"`));
        } else {
          console.log(st.error(`No session with id ${id}`));
        }
        return;
      }
      if (sub === "delete") {
        const id = args[1];
        if (!id) {
          console.log(st.warning("Usage: /sessions delete <id>"));
          return;
        }
        const ok = sm.deleteSession(id);
        if (ok) {
          console.log(st.success(`Deleted session ${id}`));
        } else {
          console.log(st.error(`No session with id ${id}`));
        }
        return;
      }
      console.log(
        st.warning(
          `Unknown /sessions subcommand "${sub}". Try list|resume|rename|delete.`,
        ),
      );
    },
  },
  {
    name: "codebase",
    category: "config",
    summary: "Manage codebase read permission: status / allow / revoke",
    usage: "/codebase [status|allow|revoke]",
    run: async (rawArgs) => {
      const args = rawArgs.trim().split(/\s+/).filter(Boolean);
      const sub = args[0] ?? "status";
      const cwd = process.cwd();
      const {
        getCodebasePermissionLevel,
        grantCodebasePermission,
        revokeCodebasePermission,
      } = await import("../utils/codebase-permissions.js");
      const { style } = await import("../utils/visual-system.js");
      const st = style();

      if (sub === "status") {
        const level = getCodebasePermissionLevel(cwd);
        if (level === "unset") {
          console.log(st.dim(`No codebase permission stored for ${cwd}.`));
          console.log(
            st.dim("  Run /codebase allow to grant always-on read access."),
          );
        } else {
          console.log(`Codebase read for ${cwd}: ${st.brand(level)}`);
        }
        return;
      }
      if (sub === "allow") {
        grantCodebasePermission(cwd, "always");
        console.log(st.success(`Granted always-on codebase read for ${cwd}.`));
        console.log(st.dim("  Revoke with: /codebase revoke"));
        return;
      }
      if (sub === "revoke") {
        revokeCodebasePermission(cwd);
        console.log(st.success(`Revoked codebase read permission for ${cwd}.`));
        return;
      }
      console.log(
        st.warning(
          `Unknown /codebase subcommand "${sub}". Try status|allow|revoke.`,
        ),
      );
    },
  },
  {
    name: "permissions",
    category: "config",
    summary: "Show read + write permission state for the current project",
    usage: "/permissions",
    run: async () => {
      const { getPermissionSnapshot } =
        await import("../utils/codebase-permissions.js");
      const { style } = await import("../utils/visual-system.js");
      const st = style();
      const cwd = process.cwd();
      const snap = getPermissionSnapshot(cwd);
      console.log("");
      console.log(st.bold(`  Permissions for ${cwd}`));
      console.log(`    Read codebase:  ${st.brand(snap.readCodebase)}`);
      console.log(`    Write files:    ${st.brand(snap.writeFiles)}`);
      console.log("");
      console.log(
        st.dim(
          "  Manage with: /codebase allow|revoke (read), /apply prompts for write per session",
        ),
      );
      console.log("");
    },
  },
  {
    name: "upgrade",
    category: "system",
    summary: "Update Consilium CLI to the latest version",
    usage: "/upgrade [--check]",
    run: async (rawArgs) => {
      const { upgradeCommand } = await import("../commands/upgrade.js");
      const checkOnly = rawArgs.trim() === "--check";
      await upgradeCommand({ check: checkOnly });
    },
  },
  {
    name: "login",
    category: "system",
    summary: "Sign in via the web (refresh CLI token)",
    usage: "/login",
    run: async () => {
      const { loginCommand } = await import("../commands/login.js");
      await loginCommand({ force: true });
    },
  },
  {
    name: "logout",
    category: "system",
    summary: "Sign out and clear stored credentials",
    usage: "/logout",
    run: async () => {
      const { logoutCommand } = await import("../commands/logout.js");
      logoutCommand();
      return { exit: true };
    },
  },
  {
    name: "read",
    category: "session",
    summary: "Read a file from the project (with line numbers)",
    usage: "/read <path>",
    run: async (rawArgs) => {
      const relPath = rawArgs.trim();
      if (!relPath) return logUsage("Usage: /read <path>");
      const { handleRead } = await import("../tools/builtin-tools.js");
      await logToolResult(
        await handleRead({ path: relPath }, { cwd: process.cwd() }),
      );
    },
  },
  {
    name: "grep",
    category: "session",
    summary: "Search file contents in the project (regex)",
    usage: "/grep <pattern> [glob]",
    run: async (rawArgs) => {
      // Quoted-pattern friendly parser: `/grep "foo.*" "**/*.ts"` and
      // `/grep foo.* **/*.ts` both work. The glob is opt-in via a
      // second argument; we no longer pluck a wildcard token off the end
      // of the pattern, which used to break regexes ending in `*`.
      const { pattern, glob } = parseGrepArgs(rawArgs);
      if (!pattern) return logUsage("Usage: /grep <regex> [glob]");
      const { handleGrep } = await import("../tools/builtin-tools.js");
      await logToolResult(
        await handleGrep({ pattern, glob }, { cwd: process.cwd() }),
      );
    },
  },
  {
    name: "find",
    category: "session",
    summary: "Find files by glob pattern",
    usage: "/find <glob>",
    run: async (rawArgs) => {
      const pattern = rawArgs.trim();
      if (!pattern) return logUsage("Usage: /find <glob>");
      const { handleGlob } = await import("../tools/builtin-tools.js");
      await logToolResult(
        await handleGlob({ pattern }, { cwd: process.cwd() }),
      );
    },
  },
  {
    name: "diff",
    category: "session",
    summary: "Show uncommitted git diff",
    usage: "/diff [path]",
    run: async (rawArgs) => {
      const subPath = rawArgs.trim() || undefined;
      const { handleGitDiff } = await import("../tools/builtin-tools.js");
      await logToolResult(
        await handleGitDiff(subPath ? { path: subPath } : {}, {
          cwd: process.cwd(),
        }),
      );
    },
  },
  {
    name: "preview",
    category: "session",
    summary: "Preview the structured edits the latest debate proposed",
    usage: "/preview",
    run: async () => {
      const { style } = await import("../utils/visual-system.js");
      const { resolveProjectRoot } = await import("../utils/project-root.js");
      const { parseEditsFromSynthesis } =
        await import("../utils/apply-edits.js");
      const { formatEditPreview } = await import("../utils/diff-preview.js");
      const { SessionManager } = await import("../utils/session-manager.js");
      const st = style();

      const sm = new SessionManager();
      const sessions = sm.listSessions();
      if (sessions.length === 0) {
        console.log(st.dim("No saved sessions yet. Run a debate first."));
        return;
      }
      const latest = sessions[0]!;
      let synthesis: string | undefined;
      try {
        const loaded = sm.loadSession(latest.id);
        synthesis = loaded.debates.at(-1)?.goldenPrompt;
      } catch (err) {
        console.log(
          st.error(
            `Could not load session ${latest.id}: ${(err as Error).message}`,
          ),
        );
        return;
      }
      if (!synthesis) {
        console.log(st.dim("Latest session has no synthesis yet."));
        return;
      }
      const root = resolveProjectRoot(process.cwd()).root;
      const parsed = parseEditsFromSynthesis(synthesis, root);
      if (parsed.edits.length === 0) {
        console.log(st.dim("No structured edits found in latest synthesis."));
        console.log(
          st.dim(
            "Tip: ask the council to emit edits as ```consilium-edits JSON or ```consilium-edit:<path> with SEARCH/REPLACE blocks.",
          ),
        );
        return;
      }
      console.log(st.bold("\nPlanned edits (latest synthesis):\n"));
      console.log(formatEditPreview(parsed.preview));
      console.log("");
      console.log(
        st.dim("  Run /apply to apply, /rollback to undo a previous apply."),
      );
    },
  },
  {
    name: "apply",
    category: "session",
    summary:
      "Apply structured edits from latest debate synthesis (with permission prompt)",
    usage: "/apply",
    run: async () => {
      const { style } = await import("../utils/visual-system.js");
      const { resolveProjectRoot } = await import("../utils/project-root.js");
      const { parseEditsFromSynthesis, applyEdits } =
        await import("../utils/apply-edits.js");
      const { formatEditPreview } = await import("../utils/diff-preview.js");
      const { SessionManager } = await import("../utils/session-manager.js");
      const { requestWritePermission, consumeWritePermission } =
        await import("../utils/codebase-permissions.js");
      const st = style();

      const sm = new SessionManager();
      const sessions = sm.listSessions();
      if (sessions.length === 0) {
        console.log(st.dim("No saved sessions yet."));
        return;
      }
      const latest = sessions[0]!;
      let synthesis: string | undefined;
      try {
        const loaded = sm.loadSession(latest.id);
        synthesis = loaded.debates.at(-1)?.goldenPrompt;
      } catch (err) {
        console.log(
          st.error(
            `Could not load session ${latest.id}: ${(err as Error).message}`,
          ),
        );
        return;
      }
      if (!synthesis) {
        console.log(st.dim("Latest session has no synthesis to apply."));
        return;
      }
      const root = resolveProjectRoot(process.cwd()).root;
      const parsed = parseEditsFromSynthesis(synthesis, root);
      if (parsed.edits.length === 0) {
        console.log(
          st.warning("No structured edits found in latest synthesis."),
        );
        return;
      }

      console.log(st.bold("\nPlanned edits:\n"));
      console.log(formatEditPreview(parsed.preview));
      console.log("");

      const level = await requestWritePermission(root);
      if (level === "deny" || !consumeWritePermission(root)) {
        console.log(
          st.warning("Write permission denied. No files were changed."),
        );
        return;
      }

      try {
        const result = applyEdits(root, parsed.edits);
        console.log(st.success(`Applied ${result.applied} edit(s).`));
        console.log(st.dim(`  Snapshot: ${result.snapshot.id}`));
        console.log(st.dim("  Run /rollback to restore."));
      } catch (err) {
        console.log(st.error(`Apply failed: ${(err as Error).message}`));
      }
    },
  },
  {
    name: "rollback",
    category: "session",
    summary: "Restore the most recent apply snapshot",
    usage: "/rollback",
    run: async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const os = await import("node:os");
      const { restoreRollbackSnapshot } = await import("../utils/rollback.js");
      const { style } = await import("../utils/visual-system.js");
      const st = style();

      const historyDir = path.join(os.homedir(), ".consilium", "edit-history");
      if (!fs.existsSync(historyDir)) {
        console.log(st.dim("No edit history yet."));
        return;
      }
      const entries = fs
        .readdirSync(historyDir)
        .filter((name) => name.startsWith("edit_"))
        .sort()
        .reverse();
      if (entries.length === 0) {
        console.log(st.dim("No edit snapshots to roll back."));
        return;
      }
      const latest = entries[0]!;
      const snapshotPath = path.join(historyDir, latest, "snapshot.json");
      if (!fs.existsSync(snapshotPath)) {
        console.log(st.error(`Snapshot file missing for ${latest}.`));
        return;
      }
      try {
        const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf-8"));
        restoreRollbackSnapshot(snapshot);
        console.log(
          st.success(
            `Restored snapshot ${latest} (${snapshot.files?.length ?? 0} files).`,
          ),
        );
      } catch (err) {
        console.log(st.error(`Rollback failed: ${(err as Error).message}`));
      }
    },
  },
  {
    name: "clear",
    category: "system",
    summary: "Clear the screen",
    usage: "/clear",
    run: async () => ({ cleared: true }),
  },
  {
    name: "help",
    category: "system",
    summary: "Show all available slash commands",
    usage: "/help",
    run: async () => {
      const { style } = await import("../utils/visual-system.js");
      const st = style();
      console.log("");
      console.log(st.bold("  Available commands"));
      console.log("");
      const widest = ALL_COMMANDS.reduce(
        (acc, c) => Math.max(acc, (c.usage ?? `/${c.name}`).length),
        0,
      );
      const groups: Array<{ label: string; key: SlashCommand["category"] }> = [
        { label: "Deliberation", key: "mode" },
        { label: "Sessions", key: "session" },
        { label: "Config", key: "config" },
        { label: "System", key: "system" },
      ];
      for (const g of groups) {
        const items = ALL_COMMANDS.filter((c) => c.category === g.key);
        if (items.length === 0) continue;
        console.log(st.dim(`  ${g.label}`));
        for (const c of items) {
          const left = (c.usage ?? `/${c.name}`).padEnd(widest + 2);
          console.log(`    ${st.brand(left)}${st.dim(c.summary)}`);
        }
        console.log("");
      }
      console.log(
        st.dim(
          "  Press /  to open the command palette · Ctrl+C or /exit to quit",
        ),
      );
      console.log("");
    },
  },
  {
    name: "exit",
    category: "system",
    summary: "Exit the Consilium REPL",
    usage: "/exit",
    run: async () => ({ exit: true }),
  },
  {
    name: "quit",
    category: "system",
    summary: "Exit the Consilium REPL (alias for /exit)",
    usage: "/quit",
    run: async () => ({ exit: true }),
  },
];

export const ALL_COMMANDS: SlashCommand[] = [
  ...modeCommands,
  ...utilityCommands,
];

export function findCommand(name: string): SlashCommand | undefined {
  const lower = name.toLowerCase();
  return ALL_COMMANDS.find((c) => c.name === lower);
}

export function filterCommands(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return ALL_COMMANDS;
  const startsWith: SlashCommand[] = [];
  const contains: SlashCommand[] = [];
  for (const c of ALL_COMMANDS) {
    if (c.name.startsWith(q)) startsWith.push(c);
    else if (c.name.includes(q) || c.summary.toLowerCase().includes(q))
      contains.push(c);
  }
  return [...startsWith, ...contains];
}
