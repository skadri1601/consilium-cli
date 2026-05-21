import { execSync } from "node:child_process";
import path from "node:path";

function run(cmd: string, cwd: string): string | null {
  try {
    return execSync(cmd, { cwd, encoding: "utf-8", timeout: 5000 }).trim();
  } catch {
    return null;
  }
}

export function isGitRepo(dir?: string): boolean {
  const cwd = dir || process.cwd();
  return run("git rev-parse --is-inside-work-tree", cwd) === "true";
}

export function getCurrentBranch(dir?: string): string | null {
  return run("git branch --show-current", dir || process.cwd());
}

export function getGitDiff(dir?: string): string | null {
  const cwd = dir || process.cwd();
  const staged = run("git diff --cached", cwd);
  const unstaged = run("git diff", cwd);

  const parts: string[] = [];
  if (staged) parts.push("=== STAGED CHANGES ===\n" + staged);
  if (unstaged) parts.push("=== UNSTAGED CHANGES ===\n" + unstaged);

  if (parts.length === 0) return null;
  return parts.join("\n\n");
}

export function getGitLog(count: number = 10, dir?: string): string | null {
  return run(`git log --oneline -${count}`, dir || process.cwd());
}

export interface GitContext {
  branch: string | null;
  diff: string | null;
  recentCommits: string | null;
}

export function collectGitContext(dir?: string): GitContext | null {
  const cwd = dir || process.cwd();
  if (!isGitRepo(cwd)) return null;

  return {
    branch: getCurrentBranch(cwd),
    diff: getGitDiff(cwd),
    recentCommits: getGitLog(5, cwd),
  };
}

export function formatGitContextForPrompt(ctx: GitContext): string {
  const parts: string[] = ["=== GIT CONTEXT ==="];
  if (ctx.branch) parts.push(`Branch: ${ctx.branch}`);
  if (ctx.recentCommits) {
    parts.push("\nRecent commits:");
    parts.push(ctx.recentCommits);
  }
  if (ctx.diff) {
    const maxDiffSize = 30000;
    const diff =
      ctx.diff.length > maxDiffSize
        ? ctx.diff.slice(0, maxDiffSize) + "\n... (diff truncated)"
        : ctx.diff;
    parts.push("\n" + diff);
  }
  parts.push("=== END GIT CONTEXT ===\n");
  return parts.join("\n");
}
