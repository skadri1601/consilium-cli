import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = path.resolve(HERE, "../../dist/index.js");

export interface CliRunOptions {
  args: string[];
  apiUrl: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  /** Pre-seed ~/.consilium/config.json with an authenticated apiKey. Default: true. */
  seedAuth?: boolean;
  /** Pre-seed additional config keys (merged with apiKey when seedAuth=true). */
  seedConfig?: Record<string, unknown>;
  /** Optional stdin payload (closed immediately after). */
  stdin?: string;
}

export interface CliRunResult {
  code: number;
  stdout: string;
  stderr: string;
  homeDir: string;
}

const activeTmpDirs: string[] = [];

function makeIsolatedHome(): string {
  const dir = path.join(os.tmpdir(), `consilium-e2e-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  activeTmpDirs.push(dir);
  return dir;
}

function seedAuthConfig(home: string, extra?: Record<string, unknown>): void {
  const configDir = path.join(home, ".consilium");
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const payload = {
    apiKey: "consilium_e2e_test_token_0123456789",
    userName: "E2E Tester",
    userEmail: "e2e@example.com",
    ...(extra ?? {}),
  };
  fs.writeFileSync(
    path.join(configDir, "config.json"),
    JSON.stringify(payload, null, 2),
    { mode: 0o600 },
  );
}

export function cleanupTmpDirs(): void {
  while (activeTmpDirs.length > 0) {
    const dir = activeTmpDirs.pop();
    if (!dir) continue;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

export async function runCli(opts: CliRunOptions): Promise<CliRunResult> {
  if (!fs.existsSync(CLI_ENTRY)) {
    throw new Error(
      `CLI bundle missing at ${CLI_ENTRY}. Run 'pnpm --filter @myconsilium/cli build' first.`,
    );
  }

  const homeDir = makeIsolatedHome();
  if (opts.seedAuth !== false) {
    seedAuthConfig(homeDir, opts.seedConfig);
  } else if (opts.seedConfig) {
    const configDir = path.join(homeDir, ".consilium");
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify(opts.seedConfig, null, 2),
      { mode: 0o600 },
    );
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    CONSILIUM_API_URL: opts.apiUrl,
    CONSILIUM_NO_COLOR: "1",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    CI: "1",
    ...(opts.env ?? {}),
  };

  const timeoutMs = opts.timeoutMs ?? 20_000;

  return await new Promise<CliRunResult>((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_ENTRY, ...opts.args], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      cwd: homeDir,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(
        new Error(
          `CLI run timed out after ${timeoutMs}ms (args: ${opts.args.join(" ")})`,
        ),
      );
    }, timeoutMs);

    child.stdout.on("data", (b: Buffer) => stdoutChunks.push(b));
    child.stderr.on("data", (b: Buffer) => stderrChunks.push(b));

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        homeDir,
      });
    });

    if (opts.stdin !== undefined) {
      child.stdin.write(opts.stdin);
    }
    child.stdin.end();
  });
}
