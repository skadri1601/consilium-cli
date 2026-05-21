import path from "node:path";
import { execSync } from "node:child_process";

export interface ProjectRootInfo {
  cwd: string;
  root: string;
  isGitRepo: boolean;
  isSubdirectory: boolean;
}

function safeGitTopLevel(cwd: string): string | null {
  try {
    const output = execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output ? path.resolve(output) : null;
  } catch {
    return null;
  }
}

export function resolveProjectRoot(cwd = process.cwd()): ProjectRootInfo {
  const normalizedCwd = path.resolve(cwd);
  const gitRoot = safeGitTopLevel(normalizedCwd);
  const root = gitRoot || normalizedCwd;
  return {
    cwd: normalizedCwd,
    root,
    isGitRepo: Boolean(gitRoot),
    isSubdirectory: normalizedCwd !== root,
  };
}
