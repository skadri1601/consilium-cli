import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockIsLoggedIn, mockLoadConfig } = vi.hoisted(() => ({
  mockIsLoggedIn: vi.fn(),
  mockLoadConfig: vi.fn(),
}));

vi.mock("../utils/config", () => ({
  isLoggedIn: mockIsLoggedIn,
  loadConfig: mockLoadConfig,
  DEFAULT_API_ORIGIN: "https://api.myconsilium.xyz",
  DEFAULT_WEB_ORIGIN: "https://myconsilium.xyz",
}));

vi.mock("../utils/visual-system", () => ({
  style: () => ({
    brand: (s: string) => s,
    dim: (s: string) => s,
    bold: (s: string) => s,
    success: (s: string) => s,
    error: (s: string) => s,
    warning: (s: string) => s,
  }),
}));

import { setupTokenCommand } from "./setup-token";

let originalFetch: typeof fetch;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let stdoutSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = 0;
  mockIsLoggedIn.mockReturnValue(true);
  mockLoadConfig.mockReturnValue({
    apiUrl: "https://api.test.example",
    webUrl: "https://web.test.example",
    apiKey: "secret-key",
  });
  originalFetch = globalThis.fetch;
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true as unknown as boolean);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  logSpy.mockRestore();
  errorSpy.mockRestore();
  stdoutSpy.mockRestore();
  process.exitCode = 0;
});

describe("setupTokenCommand", () => {
  it("exits 1 when user is not logged in", async () => {
    mockIsLoggedIn.mockReturnValue(false);

    await setupTokenCommand({});

    expect(process.exitCode).toBe(1);
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("Not logged in");
  });

  it("prints instructions on 404 without --print", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("not found", { status: 404 }),
    ) as unknown as typeof fetch;

    await setupTokenCommand({});

    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("Visit");
    expect(out).toContain("cli-tokens");
  });

  it("returns non-zero on 404 with --print and writes to stderr", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("nope", { status: 404 }),
    ) as unknown as typeof fetch;

    await setupTokenCommand({ print: true });

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("exits 1 on 401 authentication failure", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("unauthorized", { status: 401 }),
    ) as unknown as typeof fetch;

    await setupTokenCommand({});

    expect(process.exitCode).toBe(1);
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("Authentication failed");
  });

  it("exits 1 on 5xx with a descriptive message", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("boom", { status: 500 }),
    ) as unknown as typeof fetch;

    await setupTokenCommand({});

    expect(process.exitCode).toBe(1);
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("Failed to create token");
  });

  it("prints token box on successful response", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ token: "consilium_abc123", name: "ci-prod" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    ) as unknown as typeof fetch;

    await setupTokenCommand({ name: "ci-prod", days: 90 });

    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("consilium_abc123");
    expect(out).toContain("Generated CI token");
    expect(out).toContain("90 days");
    expect(process.exitCode).toBe(0);
  });

  it("writes token to stdout when --print is set", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ token: "consilium_xyz" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    await setupTokenCommand({ print: true });

    expect(stdoutSpy).toHaveBeenCalledWith("consilium_xyz\n");
  });

  it("falls back to apiKey field when token is missing", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ apiKey: "consilium_fallback" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    await setupTokenCommand({});

    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("consilium_fallback");
  });

  it("exits 1 when API returns no token value", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ name: "x" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    await setupTokenCommand({});

    expect(process.exitCode).toBe(1);
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("did not return a token");
  });

  it("exits 1 when API returns unparseable JSON", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response("<<bad json>>", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
    ) as unknown as typeof fetch;

    await setupTokenCommand({});

    expect(process.exitCode).toBe(1);
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("could not parse JSON");
  });

  it("handles fetch throw (network error) by printing instructions and exiting 1", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    await setupTokenCommand({});

    expect(process.exitCode).toBe(1);
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("Cannot connect");
  });

  it("network error with --print does not emit instructions block", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("net down");
    }) as unknown as typeof fetch;

    await setupTokenCommand({ print: true });

    expect(process.exitCode).toBe(1);
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).not.toContain("Visit");
  });

  it("parses days as number when given a string", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ token: "t" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    await setupTokenCommand({ days: "30" });

    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("30 days");
  });

  it("defaults to 365 days when given an invalid number string", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ token: "t" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    await setupTokenCommand({ days: "not-a-number" });

    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("365 days");
  });

  it("includes Bearer token in Authorization header", async () => {
    const spy = vi.fn(
      async () =>
        new Response(JSON.stringify({ token: "t" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    globalThis.fetch = spy as unknown as typeof fetch;

    await setupTokenCommand({});

    const calls = spy.mock.calls as unknown as Array<unknown[]>;
    const init = calls[0]?.[1] as
      | { headers?: Record<string, string> }
      | undefined;
    expect(init?.headers?.Authorization).toBe("Bearer secret-key");
  });
});
