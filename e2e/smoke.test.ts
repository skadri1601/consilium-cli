import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { cleanupTmpDirs, runCli } from "./helpers/spawn-cli";
import { MockApiHandle, startMockApi } from "./helpers/mock-api";

let api: MockApiHandle;

beforeAll(async () => {
  api = await startMockApi();
});

afterAll(async () => {
  await api.close();
});

afterEach(() => {
  cleanupTmpDirs();
  api.requests.length = 0;
});

function stripAnsi(s: string): string {
  return s.replace(
    // eslint-disable-next-line no-control-regex
    /\[[0-9;]*[A-Za-z]/g,
    "",
  );
}

describe("CLI smoke", () => {
  it("--help exits 0 with usage banner", async () => {
    const r = await runCli({ args: ["--help"], apiUrl: api.url });
    expect(r.code).toBe(0);
    const out = stripAnsi(r.stdout);
    expect(out).toMatch(/Usage:\s+consilium/i);
    expect(out).toMatch(/Commands:/);
    expect(out).toMatch(/debate/);
  });

  it("--version exits 0 with semver", async () => {
    const r = await runCli({ args: ["--version"], apiUrl: api.url });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+(?:[-+][\w.]+)?$/);
  });

  it("models --json lists at least one model entry", async () => {
    const r = await runCli({ args: ["models", "--json"], apiUrl: api.url });
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(Array.isArray(parsed.defaults)).toBe(true);
    expect(parsed.defaults.length).toBeGreaterThan(0);
    expect(Array.isArray(parsed.catalog)).toBe(true);
    expect(parsed.catalog.length).toBeGreaterThan(0);
  });

  it("config get apiUrl echoes the env-set URL", async () => {
    const r = await runCli({
      args: ["config", "get", "apiUrl"],
      apiUrl: api.url,
      seedAuth: false,
    });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe(api.url);
  });

  it("debate ... --output-format json streams SSE and emits JSON with synthesis", async () => {
    const r = await runCli({
      args: [
        "debate",
        "test topic",
        "--mode",
        "quick",
        "-m",
        "mock-model",
        "--output-format",
        "json",
        "--no-tools",
        "--no-context",
        "--no-git",
      ],
      apiUrl: api.url,
      timeoutMs: 25_000,
    });
    expect(r.code).toBe(0);
    const lines = r.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const jsonLine = lines.reverse().find((l) => l.startsWith("{"));
    expect(jsonLine, `no JSON line in stdout: ${r.stdout}`).toBeDefined();
    const parsed = JSON.parse(jsonLine as string);
    expect(parsed.ok).toBe(true);
    expect(typeof parsed.synthesis).toBe("string");
    expect(parsed.synthesis).toContain("Mock synthesis");
    expect(parsed.debateId).toBe("dbt_mock_01");
  });

  it("debate ... --output-format stream-json emits per-line JSON envelopes", async () => {
    const r = await runCli({
      args: [
        "debate",
        "stream topic",
        "--mode",
        "quick",
        "-m",
        "mock-model",
        "--output-format",
        "stream-json",
        "--no-tools",
        "--no-context",
        "--no-git",
      ],
      apiUrl: api.url,
      timeoutMs: 25_000,
    });
    expect(r.code).toBe(0);
    const lines = r.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("{"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    const envelopes = lines.map(
      (l) => JSON.parse(l) as Record<string, unknown>,
    );
    expect(envelopes.every((e) => typeof e.type === "string")).toBe(true);
    const completeEnvelope = envelopes.find((e) => e.type === "complete");
    expect(completeEnvelope).toBeDefined();
    const data = completeEnvelope?.data as Record<string, unknown> | undefined;
    expect(data?.synthesis).toContain("Mock synthesis");
  });

  it("setup-token --print POSTs and prints the returned token", async () => {
    const r = await runCli({
      args: ["setup-token", "--name", "test", "--print"],
      apiUrl: api.url,
    });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("consilium_mock_ci_token_abcdef123456");
    const posted = api.requests.find(
      (req) => req.method === "POST" && req.path === "/api/v1/auth/cli-tokens",
    );
    expect(posted, "expected POST to /api/v1/auth/cli-tokens").toBeDefined();
    const body = JSON.parse(posted?.body ?? "{}");
    expect(body.name).toBe("test");
  });

  it("debates list against empty mock renders the no-debates line", async () => {
    const r = await runCli({
      args: ["debates", "list"],
      apiUrl: api.url,
    });
    expect(r.code).toBe(0);
    expect(stripAnsi(r.stdout)).toMatch(/No debates found/i);
  });

  it("share <id> --public POSTs and prints the share URL", async () => {
    const r = await runCli({
      args: ["share", "sess_test_01", "--public"],
      apiUrl: api.url,
    });
    expect(r.code).toBe(0);
    const out = stripAnsi(r.stdout);
    expect(out).toMatch(/Shared session sess_test_01/);
    expect(out).toMatch(/https:\/\/mock\.example\.com\/s\/sess_test_01/);
    expect(out).toMatch(/visibility: public/);
    const posted = api.requests.find(
      (req) =>
        req.method === "POST" &&
        req.path === "/api/v1/sessions/sess_test_01/share",
    );
    expect(posted).toBeDefined();
    const body = JSON.parse(posted?.body ?? "{}");
    expect(body.public).toBe(true);
  });

  it("agents list on empty registry prints the no-agents line and exits 0", async () => {
    const r = await runCli({
      args: ["agents", "list"],
      apiUrl: api.url,
    });
    expect(r.code).toBe(0);
    const out = stripAnsi(r.stdout);
    expect(out).toMatch(/No background agents recorded/);
  });

  it("creates an isolated HOME and does not touch the real home directory", async () => {
    const r = await runCli({
      args: ["config", "list"],
      apiUrl: api.url,
    });
    expect(r.code).toBe(0);
    const cfgPath = path.join(r.homeDir, ".consilium", "config.json");
    expect(fs.existsSync(cfgPath)).toBe(true);
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
    expect(cfg.apiKey).toMatch(/^consilium_/);
  });
});
