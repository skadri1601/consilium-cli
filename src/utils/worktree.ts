import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const execFileAsync = promisify(execFile);

const WORKTREE_ROOT = path.join(os.homedir(), ".consilium", "worktrees");

export interface WorktreeRef {
  path: string;
  branch: string;
}

export interface CreateWorktreeOptions {
  cwd?: string;
}

export interface RemoveWorktreeOptions {
  force?: boolean;
  cwd?: string;
}

export interface ListWorktreesOptions {
  cwd?: string;
}

function generateWorktreeId(): string {
  return crypto.randomBytes(6).toString("hex");
}

function defaultBranchName(): string {
  const ts = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .slice(0, 14);
  return `consilium-${ts}`;
}

function ensureWorktreeRoot(): void {
  if (!fs.existsSync(WORKTREE_ROOT)) {
    fs.mkdirSync(WORKTREE_ROOT, { recursive: true, mode: 0o755 });
  }
}

async function branchExists(branch: string, cwd: string): Promise<boolean> {
  try {
    await execFileAsync(
      "git",
      ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
      { cwd },
    );
    return true;
  } catch {
    return false;
  }
}

export async function createWorktree(
  branch?: string,
  opts: CreateWorktreeOptions = {},
): Promise<WorktreeRef> {
  ensureWorktreeRoot();
  const cwd = opts.cwd ?? process.cwd();
  const branchName =
    branch && branch.trim() ? branch.trim() : defaultBranchName();
  const targetPath = path.join(WORKTREE_ROOT, generateWorktreeId());

  const exists = await branchExists(branchName, cwd);

  const args = exists
    ? ["worktree", "add", targetPath, branchName]
    : ["worktree", "add", "-b", branchName, targetPath];

  try {
    await execFileAsync("git", args, { cwd });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`git worktree add failed: ${message}`);
  }

  return { path: targetPath, branch: branchName };
}

export async function removeWorktree(
  worktreePath: string,
  opts: RemoveWorktreeOptions = {},
): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const args = ["worktree", "remove"];
  if (opts.force) args.push("--force");
  args.push(worktreePath);

  try {
    await execFileAsync("git", args, { cwd });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`git worktree remove failed: ${message}`);
  }
}

export async function listConsiliumWorktrees(
  opts: ListWorktreesOptions = {},
): Promise<WorktreeRef[]> {
  const cwd = opts.cwd ?? process.cwd();
  let stdout = "";
  try {
    const result = await execFileAsync(
      "git",
      ["worktree", "list", "--porcelain"],
      { cwd },
    );
    stdout = result.stdout;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`git worktree list failed: ${message}`);
  }

  const refs: WorktreeRef[] = [];
  const blocks = stdout
    .split(/\n\n+/)
    .map((b) => b.trim())
    .filter(Boolean);
  for (const block of blocks) {
    const lines = block.split("\n");
    let wtPath = "";
    let branch = "";
    for (const line of lines) {
      if (line.startsWith("worktree ")) wtPath = line.slice(9).trim();
      else if (line.startsWith("branch ")) {
        branch = line
          .slice(7)
          .trim()
          .replace(/^refs\/heads\//, "");
      }
    }
    if (!wtPath) continue;
    const resolvedRoot = path.resolve(WORKTREE_ROOT);
    const resolvedWt = path.resolve(wtPath);
    if (
      resolvedWt.startsWith(resolvedRoot + path.sep) ||
      resolvedWt === resolvedRoot
    ) {
      refs.push({ path: wtPath, branch: branch || "(detached)" });
    }
  }
  return refs;
}

export function getWorktreeRoot(): string {
  return WORKTREE_ROOT;
}
