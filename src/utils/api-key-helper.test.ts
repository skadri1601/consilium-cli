import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveApiKey,
  clearApiKeyHelperCache,
  __setApiKeyHelperDepsForTests,
  __resetApiKeyHelperDepsForTests,
} from "./api-key-helper";

afterEach(() => {
  __resetApiKeyHelperDepsForTests();
});

beforeEach(() => {
  clearApiKeyHelperCache();
});

describe("resolveApiKey", () => {
  it("returns null when no apiKeyHelper is configured", async () => {
    __setApiKeyHelperDepsForTests({
      loadConfig: () => ({}),
    });
    const result = await resolveApiKey("openai");
    expect(result).toBeNull();
  });

  it("returns null when provider has no helper entry", async () => {
    __setApiKeyHelperDepsForTests({
      loadConfig: () => ({
        apiKeyHelper: {
          anthropic: { command: "echo sk-test" },
        },
      }),
    });
    expect(await resolveApiKey("openai")).toBeNull();
  });

  it("returns null when helper entry has empty command", async () => {
    __setApiKeyHelperDepsForTests({
      loadConfig: () => ({
        apiKeyHelper: { openai: { command: "   " } },
      }),
    });
    expect(await resolveApiKey("openai")).toBeNull();
  });

  it("runs the configured shell command and returns trimmed stdout", async () => {
    const exec = vi.fn(async () => ({
      stdout: "sk-from-helper\n",
      stderr: "",
    }));
    __setApiKeyHelperDepsForTests({
      exec,
      loadConfig: () => ({
        apiKeyHelper: {
          openai: { command: "echo sk-from-helper" },
        },
      }),
    });

    const result = await resolveApiKey("openai");
    expect(result).toBe("sk-from-helper");
    expect(exec).toHaveBeenCalledTimes(1);
    const callArgs = exec.mock.calls[0] as unknown as [
      string,
      { timeout: number },
    ];
    expect(callArgs[0]).toBe("echo sk-from-helper");
    expect(callArgs[1].timeout).toBe(5000);
  });

  it("returns null when helper command exits non-zero", async () => {
    const exec = vi.fn(async () => {
      throw new Error("Command failed: helper");
    });
    __setApiKeyHelperDepsForTests({
      exec,
      loadConfig: () => ({
        apiKeyHelper: { openai: { command: "/bin/false" } },
      }),
    });
    expect(await resolveApiKey("openai")).toBeNull();
  });

  it("returns null when stdout is empty/whitespace", async () => {
    const exec = vi.fn(async () => ({ stdout: "   \n", stderr: "" }));
    __setApiKeyHelperDepsForTests({
      exec,
      loadConfig: () => ({
        apiKeyHelper: { openai: { command: "echo" } },
      }),
    });
    expect(await resolveApiKey("openai")).toBeNull();
  });

  it("caches the resolved key within TTL", async () => {
    const exec = vi.fn(async () => ({ stdout: "k\n", stderr: "" }));
    let now = 1_000_000;
    __setApiKeyHelperDepsForTests({
      exec,
      now: () => now,
      loadConfig: () => ({
        apiKeyHelper: {
          openai: { command: "echo k", cacheTtlMs: 60_000 },
        },
      }),
    });

    expect(await resolveApiKey("openai")).toBe("k");
    expect(await resolveApiKey("openai")).toBe("k");
    expect(await resolveApiKey("openai")).toBe("k");
    expect(exec).toHaveBeenCalledTimes(1);

    now += 60_001;
    expect(await resolveApiKey("openai")).toBe("k");
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("honors a custom timeoutMs option", async () => {
    const exec = vi.fn(async () => ({ stdout: "abc", stderr: "" }));
    __setApiKeyHelperDepsForTests({
      exec,
      loadConfig: () => ({
        apiKeyHelper: {
          anthropic: { command: "echo abc", timeoutMs: 1500 },
        },
      }),
    });
    await resolveApiKey("anthropic");
    const args = exec.mock.calls[0] as unknown as [string, { timeout: number }];
    expect(args[1].timeout).toBe(1500);
  });

  it("clearApiKeyHelperCache forces re-run", async () => {
    const exec = vi.fn(async () => ({ stdout: "v1\n", stderr: "" }));
    __setApiKeyHelperDepsForTests({
      exec,
      loadConfig: () => ({
        apiKeyHelper: { openai: { command: "echo" } },
      }),
    });

    expect(await resolveApiKey("openai")).toBe("v1");
    expect(exec).toHaveBeenCalledTimes(1);

    clearApiKeyHelperCache("openai");
    expect(await resolveApiKey("openai")).toBe("v1");
    expect(exec).toHaveBeenCalledTimes(2);
  });
});
