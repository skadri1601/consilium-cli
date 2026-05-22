import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWorktree,
  getWorktreeRoot,
  listConsiliumWorktrees,
  removeWorktree,
} from "./worktree";

function mkdtemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "consilium-worktree-test-"));
}

function initRepo(dir: string): void {
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@test.dev"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  execFileSync("git", ["config", "tag.gpgsign", "false"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "README.md"), "init\n", "utf-8");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync(
    "git",
    ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "init"],
    { cwd: dir, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } },
  );
}

describe("worktree", () => {
  const tempDirs: string[] = [];
  const createdWorktrees: string[] = [];

  beforeEach(() => {
    const root = getWorktreeRoot();
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true });
    }
  });

  afterEach(async () => {
    for (const wt of createdWorktrees) {
      try {
        if (fs.existsSync(wt)) {
          fs.rmSync(wt, { recursive: true, force: true });
        }
      } catch {
        // best-effort
      }
    }
    createdWorktrees.length = 0;
    for (const d of tempDirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
    tempDirs.length = 0;
  });

  it("creates a worktree with a generated branch when none is provided", async () => {
    const repo = mkdtemp();
    tempDirs.push(repo);
    initRepo(repo);

    const ref = await createWorktree(undefined, { cwd: repo });
    createdWorktrees.push(ref.path);

    expect(ref.path).toContain(getWorktreeRoot());
    expect(ref.branch).toMatch(/^consilium-/);
    expect(fs.existsSync(ref.path)).toBe(true);
  });

  it("creates a worktree on an explicit new branch", async () => {
    const repo = mkdtemp();
    tempDirs.push(repo);
    initRepo(repo);

    const ref = await createWorktree("feature/x", { cwd: repo });
    createdWorktrees.push(ref.path);

    expect(ref.branch).toBe("feature/x");
    expect(fs.existsSync(ref.path)).toBe(true);
  });

  it("lists only consilium-managed worktrees and removes them", async () => {
    const repo = mkdtemp();
    tempDirs.push(repo);
    initRepo(repo);

    const ref = await createWorktree("listme", { cwd: repo });
    createdWorktrees.push(ref.path);

    const refs = await listConsiliumWorktrees({ cwd: repo });
    expect(refs.some((r) => r.path === ref.path)).toBe(true);

    await removeWorktree(ref.path, { force: true, cwd: repo });
    expect(fs.existsSync(ref.path)).toBe(false);
  });
});
