import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockLoadConfig, mockLoadSession, mockSessionManagerCtor } = vi.hoisted(
  () => ({
    mockLoadConfig: vi.fn(),
    mockLoadSession: vi.fn(),
    mockSessionManagerCtor: vi.fn(),
  }),
);

vi.mock("../utils/config", () => ({
  loadConfig: mockLoadConfig,
  DEFAULT_API_ORIGIN: "https://api.myconsilium.xyz",
}));

vi.mock("../utils/session-manager", () => ({
  SessionManager: class {
    constructor(...args: unknown[]) {
      mockSessionManagerCtor(...args);
    }
    loadSession(id: string) {
      return mockLoadSession(id);
    }
  },
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

import { shareCommand } from "./share";

let originalFetch: typeof fetch;
let logSpy: ReturnType<typeof vi.spyOn>;
let cwdSpy: ReturnType<typeof vi.spyOn>;
let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = 0;
  mockLoadConfig.mockReturnValue({
    apiUrl: "https://api.test.example",
    apiKey: "test-key",
  });
  originalFetch = globalThis.fetch;
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "consilium-share-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  logSpy.mockRestore();
  cwdSpy.mockRestore();
  process.exitCode = 0;
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("shareCommand", () => {
  it("prints success message with URL when API returns 200", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            url: "https://app.test/share/abc",
            shareId: "abc",
            public: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    await shareCommand("ses_share_1");

    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("Shared session ses_share_1");
    expect(out).toContain("https://app.test/share/abc");
    expect(out).toContain("visibility: link-only");
    expect(process.exitCode).toBe(0);
  });

  it("marks visibility as public when --public flag is set", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            url: "https://app.test/p/abc",
            shareId: "abc",
            public: true,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    await shareCommand("ses_pub", { public: true });

    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("visibility: public");
  });

  it("falls back to shareId when URL is omitted", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ shareId: "short-abc" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    await shareCommand("ses_no_url");

    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("share id: short-abc");
  });

  it("exports session locally when API returns 404 and session exists", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("missing", { status: 404 }),
    ) as unknown as typeof fetch;
    mockLoadSession.mockReturnValue({
      toJSON: () => ({ id: "ses_404", debates: [] }),
    });

    await shareCommand("ses_404");

    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("Share endpoint not available");
    expect(out).toContain("exported session");

    const expectedFile = path.join(tmpDir, ".consilium-session-ses_404.json");
    expect(fs.existsSync(expectedFile)).toBe(true);
    const written = JSON.parse(fs.readFileSync(expectedFile, "utf-8"));
    expect(written.id).toBe("ses_404");
  });

  it("exports session locally when fetch throws network error", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ENETUNREACH");
    }) as unknown as typeof fetch;
    mockLoadSession.mockReturnValue({
      toJSON: () => ({ id: "ses_net", debates: [] }),
    });

    await shareCommand("ses_net");

    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("Share endpoint not available");
    const expectedFile = path.join(tmpDir, ".consilium-session-ses_net.json");
    expect(fs.existsSync(expectedFile)).toBe(true);
  });

  it("exits 1 when share fails and session is not found locally", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("nope", { status: 404 }),
    ) as unknown as typeof fetch;
    mockLoadSession.mockImplementation(() => {
      throw new Error("Session not found: ses_missing");
    });

    await shareCommand("ses_missing");

    expect(process.exitCode).toBe(1);
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("not found locally");
  });

  it("handles unparseable success response (defaults shareId to sessionId)", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response("not json", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
    ) as unknown as typeof fetch;

    await shareCommand("ses_unparse");

    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("Shared session ses_unparse");
    expect(out).toContain("share id: ses_unparse");
  });

  it("includes Authorization header when apiKey is set", async () => {
    const spy = vi.fn(
      async () =>
        new Response(JSON.stringify({ shareId: "x" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    globalThis.fetch = spy as unknown as typeof fetch;

    await shareCommand("ses_auth");

    const calls = spy.mock.calls as unknown as Array<unknown[]>;
    const init = calls[0]?.[1] as
      | { headers?: Record<string, string> }
      | undefined;
    expect(init?.headers?.Authorization).toBe("Bearer test-key");
  });

  it("prints token + url when backend returns 201 with { url, token }", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "share_1",
            token: "abcDEF123",
            url: "https://app.test/share/abcDEF123",
            expiresAt: null,
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    await shareCommand("ses_201");

    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("Shared session ses_201");
    expect(out).toContain("https://app.test/share/abcDEF123");
    expect(out).toContain("token: abcDEF123");
    expect(process.exitCode).toBe(0);
  });

  it("falls back to local export on 503 response", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("unavailable", { status: 503 }),
    ) as unknown as typeof fetch;
    mockLoadSession.mockReturnValue({
      toJSON: () => ({ id: "ses_503", debates: [] }),
    });

    await shareCommand("ses_503");

    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("Share endpoint not available");
    const expectedFile = path.join(tmpDir, ".consilium-session-ses_503.json");
    expect(fs.existsSync(expectedFile)).toBe(true);
  });

  it("includes payload in POST body when session is available", async () => {
    const spy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ token: "t1", url: "https://x.test/share/t1" }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
    );
    globalThis.fetch = spy as unknown as typeof fetch;
    mockLoadSession.mockReturnValue({
      toJSON: () => ({ id: "ses_payload", debates: [{ topic: "x" }] }),
    });

    await shareCommand("ses_payload", { public: true });

    const calls = spy.mock.calls as unknown as Array<unknown[]>;
    const init = calls[0]?.[1] as { body?: string } | undefined;
    const parsed = JSON.parse(init?.body ?? "{}");
    expect(parsed.public).toBe(true);
    expect(parsed.payload).toEqual({
      id: "ses_payload",
      debates: [{ topic: "x" }],
    });
  });

  it("omits Authorization header when apiKey is not set", async () => {
    mockLoadConfig.mockReturnValue({ apiUrl: "https://api.test.example" });
    const spy = vi.fn(
      async () =>
        new Response(JSON.stringify({ shareId: "x" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    globalThis.fetch = spy as unknown as typeof fetch;

    await shareCommand("ses_anon");

    const calls = spy.mock.calls as unknown as Array<unknown[]>;
    const init = calls[0]?.[1] as
      | { headers?: Record<string, string> }
      | undefined;
    expect(init?.headers?.Authorization).toBeUndefined();
  });
});
