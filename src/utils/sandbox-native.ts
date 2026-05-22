import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { getTrustLevel, trustPath } from "./workspace-trust";

const execFileAsync = promisify(execFile);

export type Platform = "darwin" | "linux" | "win32" | "unsupported";

export interface SandboxCapabilities {
  available: boolean;
  platform: Platform;
  mechanism: "seatbelt" | "bwrap" | "worktree-fallback" | "none";
  reason?: string;
}

export interface SandboxOptions {
  allowReadPaths?: string[];
  allowWritePaths?: string[];
  allowNetwork?: boolean;
  env?: Record<string, string>;
  cwd?: string;
}

export interface SandboxRunResult {
  stdout: string;
  stderr: string;
  code: number;
}

const SEATBELT_TEMPLATE = `(version 1)
(deny default)
(allow process-exec)
(allow process-fork)
(allow signal (target self))
(allow file-read* (subpath "/usr"))
(allow file-read* (subpath "/System"))
(allow file-read* (subpath "/Library"))
(allow file-read* (subpath "/private/etc"))
{{ALLOW_READ}}
{{ALLOW_WRITE}}
{{ALLOW_NETWORK}}
`;

type ExecFileResult = { stdout: string | Buffer; stderr: string | Buffer };
type ExecFileRunner = (
  bin: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; maxBuffer?: number },
) => Promise<ExecFileResult>;

interface PlatformDeps {
  platformOverride?: NodeJS.Platform;
  which?: (cmd: string) => boolean;
  execFile?: ExecFileRunner;
  readFile?: (p: string) => string;
  loadTemplate?: () => string;
}

let deps: PlatformDeps = {};

export function __setSandboxDepsForTests(d: PlatformDeps): void {
  deps = d;
}

export function __resetSandboxDepsForTests(): void {
  deps = {};
}

function currentPlatform(): NodeJS.Platform {
  return deps.platformOverride ?? process.platform;
}

function whichSync(cmd: string): boolean {
  if (deps.which) return deps.which(cmd);
  const pathEnv = process.env["PATH"] ?? "";
  const sep = process.platform === "win32" ? ";" : ":";
  const exts =
    process.platform === "win32"
      ? (process.env["PATHEXT"] ?? ".EXE;.BAT;.CMD").split(";")
      : [""];
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + ext);
      try {
        const st = fs.statSync(candidate);
        if (st.isFile()) return true;
      } catch {
        // ignore
      }
    }
  }
  return false;
}

export function detectPlatform(): Platform {
  const p = currentPlatform();
  if (p === "darwin") return "darwin";
  if (p === "linux") return "linux";
  if (p === "win32") return "win32";
  return "unsupported";
}

export function detectSandboxCapabilities(): SandboxCapabilities {
  const platform = detectPlatform();
  if (platform === "darwin") {
    if (whichSync("sandbox-exec")) {
      return { available: true, platform, mechanism: "seatbelt" };
    }
    return {
      available: false,
      platform,
      mechanism: "none",
      reason:
        "sandbox-exec not found on PATH. Install Xcode Command Line Tools (xcode-select --install).",
    };
  }
  if (platform === "linux") {
    if (whichSync("bwrap")) {
      return { available: true, platform, mechanism: "bwrap" };
    }
    return {
      available: false,
      platform,
      mechanism: "none",
      reason:
        "bwrap not found on PATH. Install bubblewrap (e.g., apt install bubblewrap).",
    };
  }
  if (platform === "win32") {
    return {
      available: false,
      platform,
      mechanism: "worktree-fallback",
      reason:
        "Windows has no sandbox-exec equivalent in this iteration. Use --worktree for git-level isolation.",
    };
  }
  return {
    available: false,
    platform,
    mechanism: "none",
    reason: `Unsupported platform: ${process.platform}`,
  };
}

function loadSeatbeltTemplate(): string {
  if (deps.loadTemplate) return deps.loadTemplate();
  try {
    const here =
      typeof import.meta?.url === "string"
        ? path.dirname(fileURLToPath(import.meta.url))
        : __dirname;
    const candidates = [
      path.join(here, "sandbox-profiles", "macos-seatbelt.sb"),
      path.join(
        here,
        "..",
        "src",
        "utils",
        "sandbox-profiles",
        "macos-seatbelt.sb",
      ),
    ];
    for (const c of candidates) {
      try {
        if (fs.statSync(c).isFile()) {
          const reader =
            deps.readFile ?? ((p: string) => fs.readFileSync(p, "utf-8"));
          return reader(c);
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // fall through
  }
  return SEATBELT_TEMPLATE;
}

function quoteScheme(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function buildAllowReadBlock(paths: string[]): string {
  if (paths.length === 0) return "";
  return paths
    .map((p) => `(allow file-read* (subpath ${quoteScheme(p)}))`)
    .join("\n");
}

function buildAllowWriteBlock(paths: string[]): string {
  if (paths.length === 0) return "";
  return paths
    .map(
      (p) =>
        `(allow file-write* (subpath ${quoteScheme(p)}))\n(allow file-read* (subpath ${quoteScheme(p)}))`,
    )
    .join("\n");
}

function buildAllowNetworkBlock(allow: boolean): string {
  return allow ? "(allow network*)" : "(deny network*)";
}

export function buildSeatbeltProfile(opts: SandboxOptions): string {
  const cwd = opts.cwd ?? process.cwd();
  const reads = opts.allowReadPaths ?? [cwd];
  const writes = opts.allowWritePaths ?? [cwd];
  const tmpl = loadSeatbeltTemplate();
  return tmpl
    .replace("{{ALLOW_READ}}", buildAllowReadBlock(reads))
    .replace("{{ALLOW_WRITE}}", buildAllowWriteBlock(writes))
    .replace(
      "{{ALLOW_NETWORK}}",
      buildAllowNetworkBlock(opts.allowNetwork === true),
    );
}

export function buildBwrapArgs(
  cmd: string,
  cmdArgs: string[],
  opts: SandboxOptions,
): string[] {
  const cwd = opts.cwd ?? process.cwd();
  const args: string[] = [
    "--ro-bind",
    "/",
    "/",
    "--bind",
    cwd,
    cwd,
    "--tmpfs",
    "/tmp",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--unshare-all",
  ];
  if (opts.allowNetwork === true) args.push("--share-net");
  for (const p of opts.allowWritePaths ?? []) {
    if (p !== cwd) {
      args.push("--bind", p, p);
    }
  }
  args.push(cmd, ...cmdArgs);
  return args;
}

function asString(v: string | Buffer | undefined): string {
  if (v === undefined) return "";
  return typeof v === "string" ? v : v.toString();
}

async function runWithExecFile(
  bin: string,
  args: string[],
  cwd: string | undefined,
  env: Record<string, string> | undefined,
): Promise<SandboxRunResult> {
  const runner: ExecFileRunner =
    deps.execFile ?? (execFileAsync as unknown as ExecFileRunner);
  try {
    const result = await runner(bin, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      maxBuffer: 64 * 1024 * 1024,
    });
    return {
      stdout: asString(result.stdout),
      stderr: asString(result.stderr),
      code: 0,
    };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      code?: number | string;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };
    const code = typeof e.code === "number" ? e.code : 1;
    return {
      stdout: asString(e.stdout),
      stderr: asString(e.stderr),
      code,
    };
  }
}

async function askWorkspaceTrust(
  cwd: string,
): Promise<"no" | "session" | "always"> {
  if (!process.stdin.isTTY) return "no";
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise<string>((resolve) => {
    rl.question(
      `This is your first run in ${cwd}. Trust this workspace? [no/session/always] `,
      resolve,
    );
  });
  rl.close();
  const lower = answer.trim().toLowerCase();
  if (lower === "always" || lower === "a") return "always";
  if (
    lower === "session" ||
    lower === "s" ||
    lower === "y" ||
    lower === "yes"
  ) {
    return "session";
  }
  return "no";
}

export async function ensureWorkspaceTrust(cwd: string): Promise<{
  trusted: boolean;
  level: "always" | "session" | null;
}> {
  const existing = getTrustLevel(cwd);
  if (existing === "always" || existing === "session") {
    return { trusted: true, level: existing };
  }
  const choice = await askWorkspaceTrust(cwd);
  if (choice === "no") return { trusted: false, level: null };
  trustPath(cwd, choice);
  return { trusted: true, level: choice };
}

export async function runInSandboxNative(
  cmd: string,
  args: string[],
  opts: SandboxOptions,
): Promise<SandboxRunResult> {
  if (typeof cmd !== "string" || cmd.length === 0) {
    throw new Error("runInSandboxNative: cmd must be a non-empty string");
  }
  if (!Array.isArray(args)) {
    throw new Error("runInSandboxNative: args must be an array");
  }
  const cwd = opts.cwd ?? process.cwd();

  const trustLevel = getTrustLevel(cwd);
  if (trustLevel === "always") {
    return runWithExecFile(cmd, args, cwd, opts.env);
  }

  const caps = detectSandboxCapabilities();
  if (!caps.available) {
    throw new Error(
      `Sandbox unavailable on ${caps.platform}: ${caps.reason ?? "no mechanism"}`,
    );
  }
  if (caps.mechanism === "seatbelt") {
    const profile = buildSeatbeltProfile({ ...opts, cwd });
    const sandboxArgs = ["-p", profile, cmd, ...args];
    return runWithExecFile("sandbox-exec", sandboxArgs, cwd, opts.env);
  }
  if (caps.mechanism === "bwrap") {
    const sandboxArgs = buildBwrapArgs(cmd, args, { ...opts, cwd });
    return runWithExecFile("bwrap", sandboxArgs, cwd, opts.env);
  }
  throw new Error(
    `Sandbox mechanism ${caps.mechanism} is not executable in this runner.`,
  );
}

export function describeSandboxCapability(): string {
  const caps = detectSandboxCapabilities();
  if (caps.available) {
    return `Sandbox available (platform=${caps.platform}, mechanism=${caps.mechanism}).`;
  }
  return caps.reason ?? `Sandbox unavailable on ${caps.platform}.`;
}

// Suppress unused-import warnings if os is not used downstream.
void os;
