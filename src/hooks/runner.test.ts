import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { runHooks, shouldBlock } from "./runner";
import type { HookConfig } from "./types";

function makeExecutable(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, { mode: 0o755 });
  fs.chmodSync(filePath, 0o755);
}

describe("hooks runner", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "consilium-hooks-"));
  const scriptDir = path.join(tmpRoot, "scripts");
  let originalFetch: typeof fetch;

  beforeAll(() => {
    fs.mkdirSync(scriptDir, { recursive: true });
    originalFetch = globalThis.fetch;
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("runs a command hook and captures stdout", async () => {
    const script = path.join(scriptDir, "echo-payload.sh");
    makeExecutable(
      script,
      "#!/bin/sh\nread input\nprintf 'received:%s' \"$input\"\n",
    );
    const config: HookConfig = {
      hooks: {
        SessionStart: [{ type: "command", command: script }],
      },
    };
    const results = await runHooks(
      "SessionStart",
      { foo: "bar" },
      { hooks: config, enabled: true, allowedHookUrls: [] },
    );
    expect(results).toHaveLength(1);
    const first = results[0]!;
    expect(first.ok).toBe(true);
    expect(first.output).toContain("received:");
    expect(first.output).toContain("foo");
  });

  it("returns empty array when hooks are not enabled", async () => {
    const script = path.join(scriptDir, "should-not-run.sh");
    makeExecutable(script, "#!/bin/sh\nexit 0\n");
    const config: HookConfig = {
      hooks: { Stop: [{ type: "command", command: script }] },
    };
    const results = await runHooks(
      "Stop",
      {},
      { hooks: config, enabled: false, allowedHookUrls: [] },
    );
    expect(results).toEqual([]);
  });

  it("treats exit code 2 as block:true", async () => {
    const script = path.join(scriptDir, "block.sh");
    makeExecutable(script, "#!/bin/sh\nprintf 'denied'\nexit 2\n");
    const config: HookConfig = {
      hooks: { PreToolUse: [{ type: "command", command: script }] },
    };
    const results = await runHooks(
      "PreToolUse",
      { tool: "Write" },
      { hooks: config, enabled: true, allowedHookUrls: [] },
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.block).toBe(true);
    expect(results[0]!.ok).toBe(false);
    expect(shouldBlock(results)).toBe(true);
  });

  it("non-zero non-two exit codes are failures but not blocks", async () => {
    const script = path.join(scriptDir, "fail.sh");
    makeExecutable(script, "#!/bin/sh\nexit 1\n");
    const config: HookConfig = {
      hooks: { PostToolUse: [{ type: "command", command: script }] },
    };
    const results = await runHooks(
      "PostToolUse",
      {},
      { hooks: config, enabled: true, allowedHookUrls: [] },
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(false);
    expect(results[0]!.block).toBeUndefined();
  });

  it("matcher.tool filters hooks against payload.tool", async () => {
    const script = path.join(scriptDir, "matched.sh");
    makeExecutable(script, "#!/bin/sh\nprintf 'matched'\n");
    const config: HookConfig = {
      hooks: {
        PreToolUse: [
          { type: "command", command: script, matcher: { tool: "Write" } },
          { type: "command", command: script, matcher: { tool: "Read" } },
        ],
      },
    };
    const results = await runHooks(
      "PreToolUse",
      { tool: "Write" },
      { hooks: config, enabled: true, allowedHookUrls: [] },
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.output).toBe("matched");
  });

  it("hooks with no matcher always fire", async () => {
    const script = path.join(scriptDir, "always.sh");
    makeExecutable(script, "#!/bin/sh\nprintf 'always'\n");
    const config: HookConfig = {
      hooks: {
        UserPromptSubmit: [{ type: "command", command: script }],
      },
    };
    const results = await runHooks(
      "UserPromptSubmit",
      { tool: "anything" },
      { hooks: config, enabled: true, allowedHookUrls: [] },
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(true);
  });

  it("skips http hooks whose url is not in allowedHookUrls", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const config: HookConfig = {
      hooks: {
        UserPromptSubmit: [
          {
            type: "http",
            url: "https://hooks.example.com/blocked",
            method: "POST",
          },
        ],
      },
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const results = await runHooks(
      "UserPromptSubmit",
      { prompt: "hi" },
      { hooks: config, enabled: true, allowedHookUrls: [] },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(results[0]!.ok).toBe(false);
    expect(results[0]!.error).toContain("not in allowedHookUrls");
    expect(warnSpy).toHaveBeenCalled();
  });

  it("allowed http hooks fire and respect block from response body", async () => {
    const url = "https://hooks.example.com/allowed";
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ block: true, message: "nope" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const config: HookConfig = {
      hooks: {
        UserPromptSubmit: [{ type: "http", url, method: "POST" }],
      },
    };
    const results = await runHooks(
      "UserPromptSubmit",
      { prompt: "hi" },
      { hooks: config, enabled: true, allowedHookUrls: [url] },
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(true);
    expect(results[0]!.block).toBe(true);
    expect(results[0]!.output).toBe("nope");
    expect(shouldBlock(results)).toBe(true);
  });

  it("non-OK http responses are failures, not blocks", async () => {
    const url = "https://hooks.example.com/fail";
    globalThis.fetch = vi.fn(async () => {
      return new Response("oops", { status: 500 });
    }) as unknown as typeof fetch;
    const config: HookConfig = {
      hooks: {
        Stop: [{ type: "http", url, method: "POST" }],
      },
    };
    const results = await runHooks(
      "Stop",
      {},
      { hooks: config, enabled: true, allowedHookUrls: [url] },
    );
    expect(results[0]!.ok).toBe(false);
    expect(results[0]!.error).toContain("500");
  });

  it("stops running entries after a block result", async () => {
    const script = path.join(scriptDir, "blocker.sh");
    makeExecutable(script, "#!/bin/sh\nprintf 'block'\nexit 2\n");
    const second = path.join(scriptDir, "second.sh");
    const sentinel = path.join(scriptDir, "second-ran");
    makeExecutable(second, `#!/bin/sh\ntouch ${sentinel}\n`);
    if (fs.existsSync(sentinel)) fs.unlinkSync(sentinel);
    const config: HookConfig = {
      hooks: {
        PreToolUse: [
          { type: "command", command: script },
          { type: "command", command: second },
        ],
      },
    };
    const results = await runHooks(
      "PreToolUse",
      { tool: "Write" },
      { hooks: config, enabled: true, allowedHookUrls: [] },
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.block).toBe(true);
    expect(fs.existsSync(sentinel)).toBe(false);
  });

  it("returns empty array when no entries exist for the event", async () => {
    const config: HookConfig = { hooks: {} };
    const results = await runHooks(
      "SessionEnd",
      {},
      { hooks: config, enabled: true, allowedHookUrls: [] },
    );
    expect(results).toEqual([]);
  });
});
