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
import { setupTokenCommand } from "./commands/setup-token.js";
import { menuCommand } from "./commands/menu.js";
import { voiceCommand } from "./commands/voice.js";
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
import { completionsCommand } from "./commands/completions.js";
import {
  addServerCommand,
  listServersCommand,
  removeServerCommand,
  testServerCommand,
  toolsCommand,
} from "./commands/mcp-servers.js";
import {
  browseCommand as mcpBrowseCommand,
  installCommand as mcpInstallCommand,
  searchCommand as mcpSearchCommand,
  uninstallCommand as mcpUninstallCommand,
} from "./commands/mcp-marketplace.js";
import {
  listDebatesCommand,
  cancelDebateCommand,
  startDebateCommand,
  streamDebateCommand,
} from "./commands/debates.js";
import { registerAgentsCommand } from "./commands/agents.js";
import {
  schedulerRunDaemonCommand,
  schedulerStartCommand,
  schedulerStatusCommand,
  schedulerStopCommand,
  schedulerTailCommand,
} from "./commands/scheduler.js";
import {
  linearCreateCommand,
  linearDebateCommand,
  linearListCommand,
  linearUpdateCommand,
  linearViewCommand,
} from "./commands/linear.js";
import { SessionManager } from "./utils/session-manager.js";
import { style } from "./utils/visual-system.js";

const st = style();
const KNOWN_SUBCOMMANDS = [
  "debate",
  "debates",
  "agents",
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
  "setup-token",
  "share",
  "scheduler",
  "voice",
  "linear",
  "sub-agents",
  "sub-agent",
  "completions",
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
    if (isLoggedIn()) {
      await menuCommand();
    } else {
      const { loginFlow } = await import("./commands/login.js");
      const ok = await loginFlow();
      if (ok) {
        await menuCommand();
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
    .option(
      "--plan",
      "Plan mode: emit a written plan for approval before any write",
    )
    .option(
      "--output-format <fmt>",
      "Output format: text|json|stream-json (default: text)",
    )
    .option(
      "--json-schema <path>",
      "Validate final synthesis against the given JSON Schema file; print as JSON",
    )
    .option(
      "--max-budget-usd <n>",
      "Abort if running cost estimate exceeds this many USD",
    )
    .option(
      "--max-turns <n>",
      "Cap the debate at N rounds (overrides mode default)",
    )
    .option(
      "-b, --bg",
      "Run the debate as a detached background agent (returns immediately)",
    )
    .option(
      "--generate-image",
      "Generate an image from the debate synthesis using the agents image-gen tool",
    )
    .option(
      "--image-prompt-from <src>",
      "Source of image prompt: 'synthesis' (default) or 'topic'",
      "synthesis",
    )
    .option(
      "--image-size <size>",
      "Image size for --generate-image (default 1024x1024)",
      "1024x1024",
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
    .option(
      "--plan",
      "Plan mode: emit a written plan for approval before any write",
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
    .command("setup-token")
    .description("Generate a long-lived CI token (default 365 days)")
    .option("-n, --name <name>", 'Token label (e.g. "github-actions")')
    .option("-d, --days <n>", "Token lifetime in days", "365")
    .option("--print", "Print only the token (for scripting)")
    .action((options: { name?: string; days?: string; print?: boolean }) =>
      setupTokenCommand({
        name: options.name,
        days: options.days,
        print: options.print,
      }),
    );

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

  program
    .command("voice")
    .description(
      "Record audio, transcribe via Whisper, optionally start a debate",
    )
    .option("--once", "Record one clip, print transcript, exit")
    .option("-l, --language <lang>", "BCP-47 language code", "en")
    .option("--debate", "Pipe transcript into a debate")
    .option("-m, --mode <mode>", "Debate mode (with --debate)", "council")
    .option(
      "--max-seconds <n>",
      "Maximum recording length in seconds (default 30)",
    )
    .action(
      (options: {
        once?: boolean;
        language?: string;
        debate?: boolean;
        mode?: string;
        maxSeconds?: string;
      }) =>
        voiceCommand({
          once: options.once,
          language: options.language,
          debate: options.debate,
          mode: options.mode,
          maxSeconds: options.maxSeconds
            ? Number(options.maxSeconds)
            : undefined,
        }),
    );

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

  mcp
    .command("browse")
    .description("Browse the curated MCP server marketplace")
    .option("--json", "Emit as JSON")
    .action((opts: { json?: boolean }) => mcpBrowseCommand(opts));

  mcp
    .command("search <query>")
    .description(
      "Search the MCP server marketplace by name, tag, or description",
    )
    .option("--json", "Emit as JSON")
    .action((query: string, opts: { json?: boolean }) =>
      mcpSearchCommand(query, opts),
    );

  mcp
    .command("install <name>")
    .description(
      "Install a marketplace MCP server (npm install -g + add to config)",
    )
    .option("--json", "Emit as JSON")
    .action((name: string, opts: { json?: boolean }) =>
      mcpInstallCommand(name, opts),
    );

  mcp
    .command("uninstall <name>")
    .description(
      "Remove an MCP server from config and npm-uninstall its package",
    )
    .option("--json", "Emit as JSON")
    .option("--keep-package", "Remove only the config entry; leave npm package")
    .action((name: string, opts: { json?: boolean; keepPackage?: boolean }) =>
      mcpUninstallCommand(name, opts),
    );

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

  registerAgentsCommand(program);

  const scheduler = program
    .command("scheduler")
    .description(
      "Standalone daemon that fires persisted /loop and /schedule registrations",
    );

  scheduler
    .command("start")
    .description("Start the scheduler daemon (detached background process)")
    .action(() => schedulerStartCommand());

  scheduler
    .command("stop")
    .description("Stop the running scheduler daemon")
    .action(() => schedulerStopCommand());

  scheduler
    .command("status")
    .description("Show scheduler running state and active loop/schedule counts")
    .action(() => schedulerStatusCommand());

  scheduler
    .command("tail")
    .description("Print the scheduler log")
    .option("-f, --follow", "Follow the log (like tail -f)")
    .action((opts: { follow?: boolean }) => schedulerTailCommand(opts));

  scheduler
    .command("__run__", { hidden: true })
    .description("Internal: run the scheduler loop in this process")
    .action(() => schedulerRunDaemonCommand());

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

  // === W10: share scaffold ===
  const { shareCommand } = await import("./commands/share.js");
  program
    .command("share <sessionId>")
    .description(
      "Share a saved session (POSTs to backend; falls back to local JSON export)",
    )
    .option(
      "--public",
      "Make the shared session publicly readable (default: link-only)",
    )
    .action((sessionId: string, opts: { public?: boolean }) =>
      shareCommand(sessionId, opts),
    );

  const { subAgentsListCommand, subAgentsRunCommand } =
    await import("./commands/sub-agents.js");
  const subAgentsCmd = program
    .command("sub-agents")
    .description("Manage user-defined sub-agents from ~/.consilium/agents/");
  subAgentsCmd
    .command("list")
    .description("List available sub-agents")
    .action(() => subAgentsListCommand());
  program
    .command("sub-agent <name> <prompt>")
    .description("Invoke a user-defined sub-agent with a prompt")
    .action((name: string, prompt: string) =>
      subAgentsRunCommand(name, prompt),
    );

  program
    .command("completions <shell>")
    .description("Print shell completion script (bash|zsh|fish)")
    .action((shell: string) => completionsCommand(shell));

  const linear = program
    .command("linear")
    .description("Manage Linear (MYC-) issues from the CLI");

  linear
    .command("list")
    .description("List Linear issues for the MYC team")
    .option("--mine", "Only list issues assigned to you")
    .option(
      "--state <state>",
      "Filter by workflow state name (e.g. Todo, Done)",
    )
    .option("--team <key>", "Linear team key (default: MYC)")
    .action((opts: { mine?: boolean; state?: string; team?: string }) =>
      linearListCommand(opts),
    );

  linear
    .command("view <id>")
    .description("Show one Linear issue (description, comments, state, labels)")
    .option("--team <key>", "Linear team key (default: MYC)")
    .action((id: string, opts: { team?: string }) =>
      linearViewCommand(id, opts),
    );

  linear
    .command("create <title>")
    .description("Create a new Linear issue in the MYC team")
    .option("--description <text>", "Issue description (markdown)")
    .option("--label <label>", "Label name to apply")
    .option("--assignee <email>", "Assignee email")
    .option("--team <key>", "Linear team key (default: MYC)")
    .action(
      (
        title: string,
        opts: {
          description?: string;
          label?: string;
          assignee?: string;
          team?: string;
        },
      ) => linearCreateCommand(title, opts),
    );

  linear
    .command("update <id>")
    .description(
      "Update a Linear issue's state, description, label, or assignee",
    )
    .option("--state <state>", "Workflow state name (e.g. In Progress, Done)")
    .option("--description <text>", "Replace the issue description")
    .option("--label <label>", "Replace labels with this single label")
    .option("--assignee <email>", "Reassign to this user (by email)")
    .option("--team <key>", "Linear team key (default: MYC)")
    .action(
      (
        id: string,
        opts: {
          state?: string;
          description?: string;
          label?: string;
          assignee?: string;
          team?: string;
        },
      ) => linearUpdateCommand(id, opts),
    );

  linear
    .command("debate <id>")
    .description(
      "Fetch a Linear issue and run a debate using its title + description as the topic",
    )
    .option("--mode <mode>", "Debate mode (default: council)")
    .option(
      "--post-comment",
      "Post the synthesis back as a comment on the issue (placeholder, requires SSE wiring)",
    )
    .option("-m, --models <models...>", "Models to use")
    .option("--team <key>", "Linear team key (default: MYC)")
    .action(
      (
        id: string,
        opts: {
          mode?: string;
          postComment?: boolean;
          models?: string[];
          team?: string;
        },
      ) =>
        linearDebateCommand(id, {
          ...(opts.mode !== undefined && { mode: opts.mode }),
          ...(opts.postComment !== undefined && {
            postComment: opts.postComment,
          }),
          ...(opts.models !== undefined && { models: opts.models }),
          ...(opts.team !== undefined && { team: opts.team }),
        }),
    );

  program.parse();
}

try {
  await main();
} catch (err) {
  console.error(st.error((err as Error).message));
  process.exit(1);
}
