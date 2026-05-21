#!/usr/bin/env node

import { Command } from "commander";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };
import readline from "node:readline";
import { debateCommand } from "./commands/debate.js";
import { redteamCommand } from "./commands/redteam.js";
import { evalCommand } from "./commands/eval.js";
import { benchmarkCommand } from "./commands/benchmark.js";
import {
  configSetCommand,
  configGetCommand,
  configListCommand,
} from "./commands/config.js";
import { chatCommand, chatResumeCommand } from "./commands/chat.js";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
import { debugCommand } from "./commands/debug.js";
import { logsCommand } from "./commands/logs.js";
import { statsCommand } from "./commands/stats.js";
import {
  debatePrCommand,
  debateIssueCommand,
  debateFailingCommand,
  debateStagedCommand,
} from "./commands/debate-shortcuts.js";
import { upgradeCommand } from "./commands/upgrade.js";
import { mcpCommand } from "./commands/mcp.js";
import { modelsCommand } from "./commands/models.js";
import {
  addServerCommand,
  listServersCommand,
  removeServerCommand,
  testServerCommand,
  toolsCommand,
} from "./commands/mcp-servers.js";
import {
  listDebatesCommand,
  cancelDebateCommand,
  startDebateCommand,
  streamDebateCommand,
} from "./commands/debates.js";
import { SessionManager } from "./utils/session-manager.js";
import { style } from "./utils/visual-system.js";

const st = style();
const KNOWN_SUBCOMMANDS = [
  "debate",
  "debates",
  "ask",
  "chat",
  "config",
  "sessions",
  "login",
  "logout",
  "debug",
  "logs",
  "stats",
  "redteam",
  "eval",
  "benchmark",
  "mcp",
  "models",
  "debate-pr",
  "debate-issue",
  "debate-failing",
  "debate-staged",
  "upgrade",
  "help",
];
const args = process.argv.slice(2);
const isFlag = (s: string) => s.startsWith("-");
const isDefaultRepl = args.length === 0;
const firstArg = args[0];
const isOneShot =
  args.length === 1 &&
  firstArg !== undefined &&
  !isFlag(firstArg) &&
  !KNOWN_SUBCOMMANDS.includes(firstArg);

async function main(): Promise<void> {
  if (isDefaultRepl) {
    const { isLoggedIn } = await import("./utils/config.js");
    const { runRepl } = await import("./repl/index.js");
    if (isLoggedIn()) {
      await runRepl();
    } else {
      const { loginFlow } = await import("./commands/login.js");
      const ok = await loginFlow();
      if (ok) {
        await runRepl();
      }
    }
    return;
  }
  if (isOneShot && firstArg !== undefined) {
    await debateCommand(firstArg, {});
    return;
  }

  const program = new Command();

  program
    .name("consilium")
    .description("Consilium CLI - Multi-agent debate platform")
    .version(pkg.version);

  program
    .command("debate")
    .description("Start a multi-agent debate on a topic")
    .argument("<topic>", "Topic to debate")
    .option(
      "-m, --models <models...>",
      "Models to use (e.g., gpt-5.4-mini claude-haiku-4-5-20251001)",
    )
    .option(
      "--mode <mode>",
      "Debate mode: quick, council, deep, blind, redteam, jury, market, auto (default: auto)",
    )
    .option(
      "--output <format>",
      "Output format: markdown, cursorrules, claude-md, json (default: pretty-print)",
    )
    .option("--git-diff", "(legacy alias - git context is now on by default)")
    .option("--no-git", "Don't auto-attach git diff/branch/recent commits")
    .option(
      "--no-tools",
      "Don't expose Read/Edit/Grep/Bash tools to the council",
    )
    .option("--no-context", "Disable automatic codebase context loading")
    .option(
      "--ticket <id>",
      "Linear ticket ID to include as context (e.g., MYC-123)",
    )
    .option(
      "--apply",
      "Apply structured edits from synthesis directly to files",
    )
    .option(
      "--file <paths...>",
      "Files to attach as context (e.g., --file src/auth.ts diagram.png)",
    )
    .action(debateCommand);

  program
    .command("ask")
    .description("Ask a question (alias for debate)")
    .argument("<topic>", "Question or topic")
    .option("-m, --models <models...>", "Models to use")
    .option(
      "--mode <mode>",
      "Debate mode: quick, council, deep, blind, redteam, jury, market, auto",
    )
    .option(
      "--output <format>",
      "Output format: markdown, cursorrules, claude-md, json",
    )
    .option("--git-diff", "(legacy alias - git context is now on by default)")
    .option("--no-git", "Don't auto-attach git diff/branch/recent commits")
    .option(
      "--no-tools",
      "Don't expose Read/Edit/Grep/Bash tools to the council",
    )
    .option("--no-context", "Disable automatic codebase context loading")
    .option(
      "--ticket <id>",
      "Linear ticket ID to include as context (e.g., MYC-123)",
    )
    .option(
      "--apply",
      "Apply structured edits from synthesis directly to files",
    )
    .option(
      "--file <paths...>",
      "Files to attach as context (e.g., --file src/auth.ts diagram.png)",
    )
    .action(debateCommand);

  program
    .command("redteam")
    .description("Run adversarial red team assessment")
    .argument("<content>", "Content to assess")
    .option("-m, --models <models...>", "Models to use")
    .option("--categories <categories...>", "Assessment categories")
    .action(redteamCommand);

  program
    .command("eval")
    .description("Run blind evaluation of responses")
    .argument("<topic>", "Topic or question")
    .option("--responses <file>", "JSON file with responses to evaluate")
    .option("-m, --models <models...>", "Models to use as evaluators")
    .action(evalCommand);

  program
    .command("benchmark")
    .description("Run deliberation benchmarks (MMLU, TruthfulQA, HumanEval)")
    .requiredOption(
      "--benchmark <name>",
      "Benchmark: mmlu, truthfulqa, humaneval",
    )
    .option("-m, --models <models...>", "Models to use")
    .option("--mode <mode>", "Deliberation mode (default: council)")
    .option("-n, --n <count>", "Number of questions")
    .option("--output <path>", "Save results to JSON file")
    .option("--local", "Run benchmark locally via Python")
    .action(benchmarkCommand);

  program
    .command("chat")
    .description("Start interactive chat with multi-agent debates")
    .action(chatCommand);

  program
    .command("login")
    .description("Sign in and get a CLI token (opens web app)")
    .option("--force", "Re-authenticate even if already logged in")
    .action((options: { force?: boolean }) => loginCommand(options));

  program
    .command("logout")
    .description("Sign out and clear stored credentials")
    .action(logoutCommand);

  program
    .command("debug")
    .description("Show full debug trace for a debate")
    .argument("<debateId>", "Debate ID (e.g., dbt_01HY3K...)")
    .action(debugCommand);

  program
    .command("logs")
    .description("Query logs for a debate")
    .argument("<debateId>", "Debate ID")
    .option("-l, --level <level>", "Filter by level: DEBUG, INFO, WARN, ERROR")
    .action(logsCommand);

  program
    .command("stats")
    .description("Show model performance dashboard")
    .action(statsCommand);

  program
    .command("debate-pr")
    .description(
      "Fetch a GitHub PR via gh and debate it (review, design, security)",
    )
    .argument(
      "<pr>",
      "PR number or URL (e.g. 123, https://github.com/o/r/pull/123)",
    )
    .option("-m, --models <models...>", "Models to use")
    .option("--mode <mode>", "Debate mode (default: council)")
    .option(
      "--apply",
      "Apply structured edits from synthesis directly to files",
    )
    .action(debatePrCommand);

  program
    .command("debate-issue")
    .description(
      "Fetch a GitHub issue (gh) or Linear ticket (MYC-…) and debate the spec",
    )
    .argument(
      "<id>",
      "GitHub issue number/URL or Linear ticket id (e.g. 42, MYC-123)",
    )
    .option("-m, --models <models...>", "Models to use")
    .option("--mode <mode>", "Debate mode (default: council)")
    .action(debateIssueCommand);

  program
    .command("debate-failing")
    .description(
      "Auto-detect test runner, run tests, debate the failure if any",
    )
    .option(
      "--command <cmd>",
      'Override the auto-detected test command (e.g. "vitest run --no-coverage")',
    )
    .option("-m, --models <models...>", "Models to use")
    .option("--mode <mode>", "Debate mode (default: council)")
    .action((options: { command?: string; models?: string[]; mode?: string }) =>
      debateFailingCommand(options),
    );

  program
    .command("debate-staged")
    .description("Review currently-staged git changes before commit")
    .option("-m, --models <models...>", "Models to use")
    .option("--mode <mode>", "Debate mode (default: council)")
    .action(debateStagedCommand);

  program
    .command("upgrade")
    .description(
      "Update Consilium CLI to the latest version (auto-detects pnpm/npm/yarn/bun)",
    )
    .option("--check", "Only check for a newer version, do not install")
    .action((options: { check?: boolean }) => upgradeCommand(options));

  const mcp = program
    .command("mcp")
    .description(
      "Manage MCP (Model Context Protocol) servers and integrations",
    );

  mcp
    .command("setup", { isDefault: true })
    .description(
      "Print MCP stdio config for Claude Desktop / Cursor / Claude Code (default when no subcommand)",
    )
    .option("--json", "Emit only JSON suitable for merging into MCP config")
    .action((opts: { json?: boolean }) => mcpCommand(opts));

  mcp
    .command("add <name> <command> [args...]")
    .description(
      "Register an MCP server so council models can call its tools during debates",
    )
    .option(
      "--env <KEY=value...>",
      "Set environment variables for the server process",
    )
    .option("--json", "Emit JSON result")
    .action(
      (
        name: string,
        command: string,
        args: string[] | undefined,
        options: { env?: string[]; json?: boolean },
      ) => addServerCommand(name, command, args, options),
    );

  mcp
    .command("list")
    .description("List configured MCP servers")
    .option("--json", "Emit as JSON")
    .action((opts: { json?: boolean }) => listServersCommand(opts));

  mcp
    .command("remove <name>")
    .description("Remove a configured MCP server")
    .action((name: string) => removeServerCommand(name));

  mcp
    .command("test <name>")
    .description(
      "Spawn a configured MCP server and list its tools (verifies config)",
    )
    .option("--json", "Emit as JSON")
    .action((name: string, opts: { json?: boolean }) =>
      testServerCommand(name, opts),
    );

  mcp
    .command("tools")
    .description(
      "Spawn all enabled MCP servers and list every tool they expose",
    )
    .option("--json", "Emit as JSON")
    .action((opts: { json?: boolean }) => toolsCommand(opts));

  program
    .command("models")
    .description("Show default models, full catalog, and deprecation status")
    .option(
      "--check",
      "Exit non-zero if any default model is deprecated/retired",
    )
    .option("--json", "Emit as JSON")
    .action((opts: { json?: boolean; check?: boolean }) => modelsCommand(opts));

  const debates = program
    .command("debates")
    .description("List and manage your debate sessions");

  debates
    .command("list")
    .description("List your recent debates")
    .option("-l, --limit <n>", "Number of results (max 100)", "20")
    .option("--offset <n>", "Pagination offset", "0")
    .option("--search <query>", "Filter by topic substring")
    .option("--json", "Output as JSON")
    .action(listDebatesCommand);

  debates
    .command("cancel")
    .description("Cancel an in-progress debate")
    .argument("<debateId>", "Debate ID (e.g., dbt_01HY3K...)")
    .option(
      "--deliberation",
      "Cancel a deliberation session instead of a classic debate",
    )
    .action(cancelDebateCommand);

  debates
    .command("start")
    .description("Create a debate without streaming (fire-and-forget)")
    .argument("<topic>", "Topic to debate")
    .option("-m, --models <models...>", "Models to use")
    .option(
      "--mode <mode>",
      "Debate mode: quick, council, deep, blind, redteam, jury, market, auto (default: auto)",
    )
    .option("--json", "Output result as JSON")
    .option("--file <paths...>", "Files to attach as context")
    .option("--git-diff", "(legacy alias - git context is now on by default)")
    .option("--no-git", "Don't auto-attach git diff/branch/recent commits")
    .option("--no-context", "Disable automatic codebase context loading")
    .option("--ticket <id>", "Linear ticket ID to include as context")
    .option("--mcp-tools", "(legacy alias - agent tools are now on by default)")
    .option(
      "--no-tools",
      "Don't expose Read/Edit/Grep/Bash tools or MCP server tools to the council",
    )
    .action(startDebateCommand);

  debates
    .command("stream")
    .description("Attach to a running debate's SSE stream")
    .argument("<debateId>", "Debate or deliberation ID")
    .option(
      "--deliberation",
      "Attach to a deliberation stream instead of a classic debate",
    )
    .option("--mcp-tools", "(legacy alias - agent tools are now on by default)")
    .option(
      "--no-tools",
      "Don't handle tool:call_request events with local Consilium tools / MCP servers",
    )
    .action(streamDebateCommand);

  const sessionDir = path.join(os.homedir(), ".consilium", "sessions");
  const sessionManager = new SessionManager(sessionDir);

  const sessions = program
    .command("sessions")
    .description("Manage saved chat sessions");

  sessions
    .command("list")
    .description("List saved sessions")
    .action(() => {
      const list = sessionManager.listSessions();
      if (list.length === 0) {
        console.log(
          st.dim(
            'No saved sessions. Use "consilium chat" and /save or /exit to save.',
          ),
        );
        return;
      }
      console.log(st.bold("\nSaved sessions:\n"));
      for (let i = 0; i < list.length; i++) {
        const s = list[i]!;
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
        console.log(st.dim(`     ID: ${s.id}`));
      }
      console.log(
        st.dim("\n  Resume: consilium sessions resume <session-id>\n"),
      );
    });

  sessions
    .command("resume")
    .description("Resume a saved session")
    .argument("<sessionId>", 'Session ID from "consilium sessions list"')
    .action(chatResumeCommand);

  sessions
    .command("rename")
    .description("Rename a saved session")
    .argument("<sessionId>", "Session ID")
    .argument("<name>", "New session name")
    .action((sessionId: string, name: string) => {
      const success = sessionManager.renameSession(sessionId, name);
      if (success) {
        console.log(st.success(`Session renamed to: ${name}`));
      } else {
        console.log(st.error(`Session not found: ${sessionId}`));
      }
    });

  sessions
    .command("delete")
    .description("Delete a saved session")
    .argument("<sessionId>", "Session ID")
    .action(async (sessionId: string) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question(
        st.warning(`Delete session "${sessionId}"? (y/N) `),
        (answer: string) => {
          rl.close();
          if (answer.trim().toLowerCase() === "y") {
            const deleted = sessionManager.deleteSession(sessionId);
            if (deleted) {
              console.log(st.success(`Session "${sessionId}" deleted.`));
            } else {
              console.log(st.error(`Session not found: ${sessionId}`));
            }
          } else {
            console.log(st.dim("Cancelled."));
          }
        },
      );
    });

  const config = program.command("config").description("Manage configuration");

  config
    .command("set")
    .description("Set a configuration value")
    .argument("<key>", "Configuration key (e.g., apiKey, apiUrl)")
    .argument("<value>", "Configuration value")
    .action(configSetCommand);

  config
    .command("get")
    .description("Get a configuration value")
    .argument("<key>", "Configuration key")
    .action(configGetCommand);

  config
    .command("list")
    .description("List all configuration")
    .action(configListCommand);

  program.parse();
}

try {
  await main();
} catch (err) {
  console.error(st.error((err as Error).message));
  process.exit(1);
}
