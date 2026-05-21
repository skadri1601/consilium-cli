import { describe, it, expect, vi, beforeEach } from "vitest";
import { execSync } from "node:child_process";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

const mockedExecSync = vi.mocked(execSync);

import {
  isGitRepo,
  getCurrentBranch,
  getGitDiff,
  getGitLog,
  collectGitContext,
  formatGitContextForPrompt,
  type GitContext,
} from "../utils/git-context.js";

beforeEach(() => {
  mockedExecSync.mockReset();
});

function mockExecForCmd(mapping: Record<string, string>) {
  mockedExecSync.mockImplementation((cmd: string) => {
    for (const [key, val] of Object.entries(mapping)) {
      if ((cmd as string).includes(key)) return val as any;
    }
    throw new Error(`Command failed: ${cmd}`);
  });
}

describe("isGitRepo", () => {
  it("returns true when inside a git work tree", () => {
    mockedExecSync.mockReturnValue("true" as any);
    expect(isGitRepo("/some/dir")).toBe(true);
  });

  it("returns false when git command fails", () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error("not a git repo");
    });
    expect(isGitRepo("/some/dir")).toBe(false);
  });

  it('returns false when output is not "true"', () => {
    mockedExecSync.mockReturnValue("false" as any);
    expect(isGitRepo("/some/dir")).toBe(false);
  });
});

describe("getCurrentBranch", () => {
  it("returns the branch name", () => {
    mockedExecSync.mockReturnValue("feature/my-branch" as any);
    expect(getCurrentBranch("/dir")).toBe("feature/my-branch");
  });

  it("returns null when git fails", () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error("fail");
    });
    expect(getCurrentBranch("/dir")).toBeNull();
  });
});

describe("getGitDiff", () => {
  it("returns combined staged and unstaged diffs", () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if ((cmd as string).includes("--cached"))
        return "staged diff content" as any;
      if ((cmd as string).includes("git diff"))
        return "unstaged diff content" as any;
      throw new Error("unexpected");
    });

    const result = getGitDiff("/dir");
    expect(result).toContain("=== STAGED CHANGES ===");
    expect(result).toContain("staged diff content");
    expect(result).toContain("=== UNSTAGED CHANGES ===");
    expect(result).toContain("unstaged diff content");
  });

  it("returns null when no diffs exist", () => {
    mockedExecSync.mockReturnValue("" as any);
    expect(getGitDiff("/dir")).toBeNull();
  });

  it("returns only staged when unstaged is empty", () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if ((cmd as string).includes("--cached")) return "staged only" as any;
      return "" as any;
    });

    const result = getGitDiff("/dir");
    expect(result).toContain("STAGED CHANGES");
    expect(result).not.toContain("UNSTAGED CHANGES");
  });
});

describe("getGitLog", () => {
  it("returns log output", () => {
    mockedExecSync.mockReturnValue("abc123 initial commit" as any);
    expect(getGitLog(5, "/dir")).toBe("abc123 initial commit");
  });

  it("returns null when git fails", () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error("fail");
    });
    expect(getGitLog(5, "/dir")).toBeNull();
  });
});

describe("collectGitContext", () => {
  it("returns null when not in a git repo", () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error("not a git repo");
    });
    expect(collectGitContext("/dir")).toBeNull();
  });

  it("returns branch, diff, and commits when in a repo", () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if ((cmd as string).includes("rev-parse")) return "true" as any;
      if ((cmd as string).includes("branch --show-current"))
        return "main" as any;
      if ((cmd as string).includes("diff --cached")) return "staged" as any;
      if ((cmd as string).includes("git diff")) return "unstaged" as any;
      if ((cmd as string).includes("log")) return "abc1234 commit msg" as any;
      throw new Error("unexpected cmd");
    });

    const ctx = collectGitContext("/dir");
    expect(ctx).not.toBeNull();
    expect(ctx!.branch).toBe("main");
    expect(ctx!.diff).toContain("staged");
    expect(ctx!.recentCommits).toBe("abc1234 commit msg");
  });

  it("returns null diff when no changes", () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if ((cmd as string).includes("rev-parse")) return "true" as any;
      if ((cmd as string).includes("branch --show-current"))
        return "dev" as any;
      if ((cmd as string).includes("diff")) return "" as any;
      if ((cmd as string).includes("log")) return "abc commit" as any;
      throw new Error("unexpected");
    });

    const ctx = collectGitContext("/dir");
    expect(ctx!.diff).toBeNull();
  });
});

describe("formatGitContextForPrompt", () => {
  it("includes branch name", () => {
    const ctx: GitContext = {
      branch: "feature/x",
      diff: null,
      recentCommits: null,
    };
    const result = formatGitContextForPrompt(ctx);
    expect(result).toContain("Branch: feature/x");
  });

  it("includes recent commits", () => {
    const ctx: GitContext = {
      branch: null,
      diff: null,
      recentCommits: "abc fix bug",
    };
    const result = formatGitContextForPrompt(ctx);
    expect(result).toContain("Recent commits:");
    expect(result).toContain("abc fix bug");
  });

  it("includes diff content", () => {
    const ctx: GitContext = {
      branch: null,
      diff: "some diff",
      recentCommits: null,
    };
    const result = formatGitContextForPrompt(ctx);
    expect(result).toContain("some diff");
  });

  it("truncates large diffs at 30000 chars", () => {
    const largeDiff = "x".repeat(40000);
    const ctx: GitContext = {
      branch: null,
      diff: largeDiff,
      recentCommits: null,
    };
    const result = formatGitContextForPrompt(ctx);
    expect(result).toContain("... (diff truncated)");
    expect(result.length).toBeLessThan(40000);
  });

  it("wraps output in context markers", () => {
    const ctx: GitContext = { branch: "main", diff: null, recentCommits: null };
    const result = formatGitContextForPrompt(ctx);
    expect(result).toContain("=== GIT CONTEXT ===");
    expect(result).toContain("=== END GIT CONTEXT ===");
  });
});
