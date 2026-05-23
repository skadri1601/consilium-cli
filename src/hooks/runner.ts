import { execFile } from "node:child_process";
import {
  type CommandHookEntry,
  type HookConfig,
  type HookEntry,
  type HookEvent,
  type HookMatcher,
  type HookResult,
  type HookRunnerOptions,
  type HttpHookEntry,
} from "./types";
import { loadConsiliumSettings, loadHooks } from "./loader";

export type { HookConfig, HookEntry, HookEvent, HookResult } from "./types";

const DEFAULT_TIMEOUT_MS = 5000;

function matcherMatches(
  matcher: HookMatcher | undefined,
  payload: Record<string, unknown>,
): boolean {
  if (!matcher) return true;
  if (matcher.tool !== undefined) {
    if (payload.tool !== matcher.tool) return false;
  }
  if (matcher.promptPattern !== undefined) {
    const prompt =
      typeof payload.prompt === "string" ? payload.prompt : undefined;
    if (!prompt) return false;
    try {
      const re = new RegExp(matcher.promptPattern);
      if (!re.test(prompt)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function parseCommand(command: string): { bin: string; args: string[] } {
  const parts: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if ((ch === " " || ch === "\t") && !inSingle && !inDouble) {
      if (current.length > 0) {
        parts.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) parts.push(current);
  return { bin: parts[0] ?? "", args: parts.slice(1) };
}

function runCommandHook(
  entry: CommandHookEntry,
  payload: Record<string, unknown>,
  defaultTimeoutMs: number,
): Promise<HookResult> {
  const timeout = entry.timeoutMs ?? defaultTimeoutMs;
  const { bin, args } = parseCommand(entry.command);
  if (!bin) {
    return Promise.resolve({ ok: false, error: "Empty hook command" });
  }
  return new Promise<HookResult>((resolve) => {
    const child = execFile(
      bin,
      args,
      { timeout, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        const out = stdout?.toString().trim();
        const err = stderr?.toString().trim();
        if (error) {
          const code = (error as NodeJS.ErrnoException & { code?: number })
            .code;
          if (code === 2) {
            resolve({
              ok: false,
              block: true,
              output: out || undefined,
              error: err || error.message,
            });
            return;
          }
          resolve({
            ok: false,
            output: out || undefined,
            error: err || error.message,
          });
          return;
        }
        resolve({ ok: true, output: out || undefined });
      },
    );

    try {
      if (child.stdin) {
        child.stdin.end(JSON.stringify(payload));
      }
    } catch {
      // best-effort: if stdin write fails, command still runs
    }
  });
}

async function runHttpHook(
  entry: HttpHookEntry,
  payload: Record<string, unknown>,
  allowedUrls: string[],
  defaultTimeoutMs: number,
): Promise<HookResult> {
  if (!allowedUrls.includes(entry.url)) {
    console.warn(
      `[consilium hooks] skipping http hook to ${entry.url}: not in allowedHookUrls`,
    );
    return {
      ok: false,
      error: `URL not in allowedHookUrls: ${entry.url}`,
    };
  }
  const method = entry.method ?? "POST";
  const timeout = entry.timeoutMs ?? defaultTimeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(entry.url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(payload),
      signal: controller.signal,
    });
    let parsedBody: { block?: boolean; message?: string } = {};
    try {
      parsedBody = (await res.json()) as { block?: boolean; message?: string };
    } catch {
      // non-JSON body is acceptable: treat as no-op
    }
    if (!res.ok) {
      return {
        ok: false,
        error: `HTTP ${res.status}`,
        output: parsedBody.message,
      };
    }
    return {
      ok: true,
      block: parsedBody.block === true ? true : undefined,
      output: parsedBody.message,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

async function runEntry(
  entry: HookEntry,
  payload: Record<string, unknown>,
  allowedUrls: string[],
  defaultTimeoutMs: number,
): Promise<HookResult> {
  if (entry.type === "command") {
    return runCommandHook(entry, payload, defaultTimeoutMs);
  }
  return runHttpHook(entry, payload, allowedUrls, defaultTimeoutMs);
}

export async function runHooks(
  event: HookEvent,
  payload: Record<string, unknown>,
  options: HookRunnerOptions = {},
): Promise<HookResult[]> {
  const settings = loadConsiliumSettings();
  const enabled = options.enabled ?? settings.hooksEnabled;
  if (!enabled) return [];

  const config: HookConfig = options.hooks ?? loadHooks();
  const entries = config.hooks[event] ?? [];
  if (entries.length === 0) return [];

  const allowedUrls = options.allowedHookUrls ?? settings.allowedHookUrls;
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const applicable = entries.filter((entry) =>
    matcherMatches(entry.matcher, payload),
  );

  const results: HookResult[] = [];
  for (const entry of applicable) {
    const result = await runEntry(
      entry,
      payload,
      allowedUrls,
      defaultTimeoutMs,
    );
    results.push(result);
    if (result.block) break;
  }
  return results;
}

export function shouldBlock(results: HookResult[]): boolean {
  return results.some((r) => r.block === true);
}

export async function safeRunHooks(
  event: HookEvent,
  payload: Record<string, unknown>,
  options: HookRunnerOptions = {},
): Promise<HookResult[]> {
  try {
    return await runHooks(event, payload, options);
  } catch {
    return [];
  }
}
