import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { style } from "../utils/visual-system.js";
import { resolveProjectRoot } from "../utils/project-root.js";
import { debateCommand, type DebateCommandOptions } from "./debate.js";

const execFileAsync = promisify(execFile);
const st = style();

/**
 * High-leverage shortcut commands. Each wraps the standard debateCommand
 * after pre-building a topic + extra projectContext from the user's
 * actual workflow state (PR diff, issue, failing test, staged changes).
 *
 * The point: developers don't run `consilium debate "what should I do?"`
 * out of nowhere - they run it because they're stuck on something
 * concrete. These commands meet them where they actually are.
 */

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function tryExec(
  cmd: string,
  args: string[],
  cwd?: string,
): Promise<ExecResult | null> {
  try {
    const result = await execFileAsync(cmd, args, {
      cwd,
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (err) {
    const e = err as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    if (e.code === "ENOENT") return null;
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? "",
      exitCode: typeof e.code === "number" ? e.code : 1,
    };
  }
}

async function hasCommand(cmd: string): Promise<boolean> {
  const result = await tryExec(cmd, ["--version"]);
  return result !== null && result.exitCode === 0;
}

// ─────────────────────────── debate-pr ───────────────────────────

export interface DebatePrOptions extends DebateCommandOptions {}

export async function debatePrCommand(
  prRef: string,
  options: DebatePrOptions = {},
): Promise<void> {
  if (!prRef) {
    console.log(st.error("Usage: consilium debate-pr <number-or-url>"));
    process.exit(1);
  }

  if (!(await hasCommand("gh"))) {
    console.log(st.error("GitHub CLI (gh) not found."));
    console.log(st.dim("  Install: https://cli.github.com"));
    console.log(st.dim("  Then:    gh auth login"));
    process.exit(1);
  }

  const prNumber = prRef.replace(/^.*\//, "").replace(/^#/, "");
  console.log(st.dim(`  Fetching PR ${prNumber} via gh...`));

  const meta = await tryExec("gh", [
    "pr",
    "view",
    prNumber,
    "--json",
    "title,body,author,baseRefName,headRefName,additions,deletions,files",
  ]);
  if (!meta || meta.exitCode !== 0) {
    console.log(
      st.error(
        `Could not fetch PR ${prNumber}: ${meta?.stderr || "unknown error"}`,
      ),
    );
    process.exit(1);
  }

  let prMeta: {
    title?: string;
    body?: string;
    author?: { login?: string };
    baseRefName?: string;
    headRefName?: string;
    additions?: number;
    deletions?: number;
    files?: Array<{ path: string; additions: number; deletions: number }>;
  };
  try {
    prMeta = JSON.parse(meta.stdout);
  } catch {
    console.log(st.error("Could not parse gh PR metadata."));
    process.exit(1);
  }

  const diff = await tryExec("gh", ["pr", "diff", prNumber]);
  if (!diff || diff.exitCode !== 0) {
    console.log(
      st.warning(
        `  Could not fetch PR diff: ${diff?.stderr || "unknown error"}`,
      ),
    );
  }

  const fileSummary = (prMeta.files ?? [])
    .slice(0, 25)
    .map((f) => `  - ${f.path} (+${f.additions} / −${f.deletions})`)
    .join("\n");
  const truncatedDiff = (diff?.stdout ?? "").slice(0, 60_000);
  const diffNote =
    (diff?.stdout?.length ?? 0) > 60_000 ? "\n...[truncated]" : "";

  const topic = [
    `# PR #${prNumber}: ${prMeta.title ?? "(no title)"}`,
    "",
    `Author: ${prMeta.author?.login ?? "unknown"}`,
    `Base: ${prMeta.baseRefName ?? "?"} ← Head: ${prMeta.headRefName ?? "?"}`,
    `Stats: +${prMeta.additions ?? 0} / −${prMeta.deletions ?? 0} across ${prMeta.files?.length ?? 0} files`,
    "",
    "## Description",
    prMeta.body?.trim() || "(no description)",
    "",
    "## Files changed",
    fileSummary || "(no files)",
    "",
    "## Diff",
    "```diff",
    truncatedDiff,
    "```",
    diffNote,
    "",
    "---",
    "",
    'Council: review this PR. Identify correctness issues, design concerns, missed edge cases, and security implications. Recommend either "approve", "request changes", or "needs discussion" with specific reasons.',
  ].join("\n");

  await debateCommand(topic, { ...options, mode: options.mode ?? "council" });
}

// ─────────────────────── debate-issue ─────────────────────────

export interface DebateIssueOptions extends DebateCommandOptions {}

export async function debateIssueCommand(
  issueRef: string,
  options: DebateIssueOptions = {},
): Promise<void> {
  if (!issueRef) {
    console.log(st.error("Usage: consilium debate-issue <number-or-MYC-id>"));
    process.exit(1);
  }

  // Linear ticket pattern (MYC-123) routes through the existing --ticket
  // flow which already has formatTicketForPrompt. GitHub issue numbers
  // route through gh.
  const linearMatch = /^[A-Z]{2,5}-\d+$/.exec(issueRef);
  if (linearMatch) {
    const topic = `Council: read the linked Linear ticket and produce an implementation plan with concrete file paths, edge cases, and a recommended sequence of commits.`;
    await debateCommand(topic, {
      ...options,
      ticket: issueRef,
      mode: options.mode ?? "council",
    });
    return;
  }

  if (!(await hasCommand("gh"))) {
    console.log(
      st.error(
        "GitHub CLI (gh) not found and the ref is not a Linear ticket id.",
      ),
    );
    console.log(
      st.dim("  Install gh: https://cli.github.com  (then: gh auth login)"),
    );
    console.log(
      st.dim(
        "  Or pass a Linear ticket id like MYC-123 to use --ticket fetching.",
      ),
    );
    process.exit(1);
  }

  const issueNumber = issueRef.replace(/^.*\//, "").replace(/^#/, "");
  console.log(st.dim(`  Fetching issue ${issueNumber} via gh...`));

  const meta = await tryExec("gh", [
    "issue",
    "view",
    issueNumber,
    "--json",
    "title,body,author,labels,assignees,state,comments",
  ]);
  if (!meta || meta.exitCode !== 0) {
    console.log(
      st.error(
        `Could not fetch issue ${issueNumber}: ${meta?.stderr || "unknown error"}`,
      ),
    );
    process.exit(1);
  }

  let issueMeta: {
    title?: string;
    body?: string;
    author?: { login?: string };
    state?: string;
    labels?: Array<{ name: string }>;
    comments?: Array<{ author: { login: string }; body: string }>;
  };
  try {
    issueMeta = JSON.parse(meta.stdout);
  } catch {
    console.log(st.error("Could not parse gh issue metadata."));
    process.exit(1);
  }

  const labels =
    (issueMeta.labels ?? []).map((l) => l.name).join(", ") || "none";
  const recentComments = (issueMeta.comments ?? [])
    .slice(-3)
    .map((c) => `**@${c.author.login}:** ${c.body}`)
    .join("\n\n");

  const topic = [
    `# Issue #${issueNumber}: ${issueMeta.title ?? "(no title)"}`,
    "",
    `Author: ${issueMeta.author?.login ?? "unknown"}  ·  State: ${issueMeta.state ?? "unknown"}  ·  Labels: ${labels}`,
    "",
    "## Description",
    issueMeta.body?.trim() || "(no description)",
    "",
    recentComments ? "## Recent comments\n\n" + recentComments : "",
    "",
    "---",
    "",
    "Council: produce an implementation plan with concrete file paths, edge cases, and a recommended sequence of commits.",
  ]
    .filter(Boolean)
    .join("\n");

  await debateCommand(topic, { ...options, mode: options.mode ?? "council" });
}

// ─────────────────────── debate-failing ───────────────────────

export interface DebateFailingOptions extends DebateCommandOptions {
  command?: string;
}

function testRunnerCandidates(
  root: string,
): Array<{ probe: () => Promise<boolean>; cmd: string; args: string[] }> {
  const has = (f: string) => fs.existsSync(path.join(root, f));
  return [
    {
      probe: async () =>
        has("package.json") &&
        /pnpm/.test((await tryExec("pnpm", ["-v"]))?.stdout ?? ""),
      cmd: "pnpm",
      args: ["test"],
    },
    {
      probe: async () => has("package.json"),
      cmd: "npm",
      args: ["test"],
    },
    {
      probe: async () =>
        has("pyproject.toml") || has("pytest.ini") || has("tests"),
      cmd: "pytest",
      args: ["-x", "--tb=short"],
    },
    {
      probe: async () => has("Cargo.toml"),
      cmd: "cargo",
      args: ["test"],
    },
    {
      probe: async () => has("go.mod"),
      cmd: "go",
      args: ["test", "./..."],
    },
  ];
}

async function detectTestCommand(
  root: string,
): Promise<{ cmd: string; args: string[] } | null> {
  for (const c of testRunnerCandidates(root)) {
    try {
      if (await c.probe()) return { cmd: c.cmd, args: c.args };
    } catch {
      // probe failures fall through to the next candidate
    }
  }
  return null;
}

export async function debateFailingCommand(
  options: DebateFailingOptions = {},
): Promise<void> {
  const root = resolveProjectRoot(process.cwd()).root;

  let command: { cmd: string; args: string[] };
  if (options.command) {
    const parts = options.command.split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      console.log(st.error("--command was empty."));
      process.exit(1);
    }
    command = { cmd: parts[0]!, args: parts.slice(1) };
  } else {
    const detected = await detectTestCommand(root);
    if (!detected) {
      console.log(st.error("Could not detect a test runner."));
      console.log(st.dim('  Use --command "<your test command>" to override.'));
      process.exit(1);
    }
    command = detected;
  }

  console.log(st.dim(`  Running: ${command.cmd} ${command.args.join(" ")}`));
  const result = await tryExec(command.cmd, command.args, root);
  if (!result) {
    console.log(st.error(`Test runner not found: ${command.cmd}`));
    process.exit(1);
  }
  if (result.exitCode === 0) {
    console.log(st.success("  All tests pass - nothing to debate."));
    return;
  }

  const output = (result.stdout + "\n" + result.stderr).slice(0, 32_000);

  const topic = [
    `# Failing test run: ${command.cmd} ${command.args.join(" ")}`,
    "",
    `Exit code: ${result.exitCode}`,
    "",
    "## Output",
    "```",
    output,
    "```",
    "",
    "---",
    "",
    "Council: identify the root cause of the failure (not just the surface symptom). Recommend a fix with specific file paths and exact code changes. Note any related tests that may also be affected.",
  ].join("\n");

  await debateCommand(topic, { ...options, mode: options.mode ?? "council" });
}

// ─────────────────────── debate-staged ────────────────────────

export interface DebateStagedOptions extends DebateCommandOptions {}

export async function debateStagedCommand(
  options: DebateStagedOptions = {},
): Promise<void> {
  const root = resolveProjectRoot(process.cwd()).root;
  if (!fs.existsSync(path.join(root, ".git"))) {
    console.log(st.error("Not a git repository."));
    process.exit(1);
  }

  const staged = await tryExec("git", ["diff", "--staged"], root);
  if (!staged || staged.exitCode !== 0) {
    console.log(
      st.error(
        `git diff --staged failed: ${staged?.stderr || "unknown error"}`,
      ),
    );
    process.exit(1);
  }

  if (!staged.stdout.trim()) {
    console.log(st.warning("  Nothing staged. `git add` files first."));
    return;
  }

  const stat = await tryExec("git", ["diff", "--staged", "--stat"], root);
  const branch = await tryExec(
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    root,
  );
  const diff = staged.stdout.slice(0, 50_000);
  const diffNote = staged.stdout.length > 50_000 ? "\n...[truncated]" : "";

  const topic = [
    `# Staged changes review (${branch?.stdout.trim() ?? "unknown branch"})`,
    "",
    "## Stat",
    "```",
    stat?.stdout.trim() ?? "",
    "```",
    "",
    "## Diff",
    "```diff",
    diff,
    "```",
    diffNote,
    "",
    "---",
    "",
    "Council: review this diff before commit. Identify correctness issues, missed edge cases, name/style inconsistency, security concerns, and missing tests. Recommend whether to commit as-is, amend, or rework - with specific reasons.",
  ].join("\n");

  await debateCommand(topic, { ...options, mode: options.mode ?? "council" });
}
