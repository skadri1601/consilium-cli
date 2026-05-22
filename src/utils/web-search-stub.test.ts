import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockLoadConfig } = vi.hoisted(() => ({
  mockLoadConfig: vi.fn(),
}));

vi.mock("./config", () => ({
  loadConfig: mockLoadConfig,
  DEFAULT_API_ORIGIN: "https://api.myconsilium.xyz",
}));

import { webSearch } from "./web-search-stub";

let originalFetch: typeof fetch;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadConfig.mockReturnValue({
    apiUrl: "https://api.test.example",
    apiKey: "test-key",
  });
  originalFetch = globalThis.fetch;
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  logSpy.mockRestore();
});

describe("webSearch", () => {
  it("returns unavailable provider when fetch throws (network failure)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const out = await webSearch("hello");
    expect(out.provider).toBe("unavailable");
    expect(out.results).toEqual([]);
    expect(logSpy).toHaveBeenCalled();
  });

  it("returns unavailable provider on 404 response", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("not found", { status: 404 }),
    ) as unknown as typeof fetch;

    const out = await webSearch("missing");
    expect(out.provider).toBe("unavailable");
    expect(out.results).toEqual([]);
  });

  it("returns unavailable provider on 503 response", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: "provider_unavailable",
            provider: "duckduckgo",
            message: "rate limited",
          }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    const out = await webSearch("hello");
    expect(out.provider).toBe("unavailable");
    expect(out.results).toEqual([]);
    expect(logSpy).toHaveBeenCalled();
  });

  it("returns unavailable provider on non-OK non-404 status", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("server err", { status: 500 }),
    ) as unknown as typeof fetch;

    const out = await webSearch("hello");
    expect(out.provider).toBe("unavailable");
    expect(out.results).toEqual([]);
  });

  it("returns results when API responds with a results array", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                title: "A",
                url: "https://a.test",
                snippet: "hello",
                published: null,
                source: "duckduckgo",
              },
            ],
            provider: "duckduckgo",
            cached: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    const out = await webSearch("query");
    expect(out.provider).toBe("duckduckgo");
    expect(out.results).toHaveLength(1);
    expect(out.results[0]?.title).toBe("A");
    expect(out.results[0]?.url).toBe("https://a.test");
    expect(out.results[0]?.source).toBe("duckduckgo");
    expect(out.cached).toBe(false);
  });

  it("returns mapped citations when API responds with citations", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                title: "A",
                url: "https://a.test",
                snippet: "hello",
              },
            ],
            provider: "duckduckgo",
            citations: [
              {
                index: 1,
                title: "A",
                url: "https://a.test",
                snippet: "hello",
                domain: "a.test",
                source: "duckduckgo",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    const out = await webSearch("q");
    expect(out.citations).toHaveLength(1);
    expect(out.citations?.[0]?.index).toBe(1);
    expect(out.citations?.[0]?.domain).toBe("a.test");
  });

  it("filters out malformed result entries", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: [
              { title: "valid", url: "https://v.test", snippet: "ok" },
              { title: 1, url: "https://x.test" },
              { url: "https://no-title.test" },
              null,
              "string",
            ],
            provider: "duckduckgo",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    const out = await webSearch("q");
    expect(out.results).toHaveLength(1);
    expect(out.results[0]?.title).toBe("valid");
  });

  it("returns empty when payload lacks a results array", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ provider: "x" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    const out = await webSearch("q");
    expect(out.provider).toBe("x");
    expect(out.results).toEqual([]);
  });

  it("returns unavailable when JSON parsing fails", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response("<<not json>>", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
    ) as unknown as typeof fetch;

    const out = await webSearch("q");
    expect(out.provider).toBe("unavailable");
    expect(out.results).toEqual([]);
  });

  it("sends Authorization header when an API key is configured", async () => {
    const spy = vi.fn(
      async () =>
        new Response(JSON.stringify({ results: [], provider: "x" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    globalThis.fetch = spy as unknown as typeof fetch;

    await webSearch("q");
    const calls = spy.mock.calls as unknown as Array<unknown[]>;
    const init = calls[0]?.[1] as
      | { headers?: Record<string, string> }
      | undefined;
    expect(init?.headers?.Authorization).toBe("Bearer test-key");
  });

  it("omits Authorization when no API key is configured", async () => {
    mockLoadConfig.mockReturnValue({ apiUrl: "https://api.test.example" });
    const spy = vi.fn(
      async () =>
        new Response(JSON.stringify({ results: [], provider: "x" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    globalThis.fetch = spy as unknown as typeof fetch;

    await webSearch("q");
    const calls = spy.mock.calls as unknown as Array<unknown[]>;
    const init = calls[0]?.[1] as
      | { headers?: Record<string, string> }
      | undefined;
    expect(init?.headers?.Authorization).toBeUndefined();
  });

  it("forwards limit and provider in the request body when supplied", async () => {
    const spy = vi.fn(
      async () =>
        new Response(JSON.stringify({ results: [], provider: "brave" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    globalThis.fetch = spy as unknown as typeof fetch;

    await webSearch("q", { limit: 7, provider: "brave" });
    const calls = spy.mock.calls as unknown as Array<unknown[]>;
    const init = calls[0]?.[1] as { body?: string } | undefined;
    const body = init?.body ? JSON.parse(init.body) : {};
    expect(body.query).toBe("q");
    expect(body.limit).toBe(7);
    expect(body.provider).toBe("brave");
  });
});
