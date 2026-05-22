import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockListKeys, mockGetKey, mockGetAvailableProviders } = vi.hoisted(
  () => ({
    mockListKeys: vi.fn(),
    mockGetKey: vi.fn(),
    mockGetAvailableProviders: vi.fn(),
  }),
);

vi.mock("./key-manager", () => {
  class KeyManager {
    listKeys = mockListKeys;
    getKey = mockGetKey;
    getAvailableProviders = mockGetAvailableProviders;
  }
  return {
    KeyManager,
    PROVIDER_ENV_VARS: {
      openai: "OPENAI_API_KEY",
      anthropic: "ANTHROPIC_API_KEY",
      google: "GOOGLE_API_KEY",
      groq: "GROQ_API_KEY",
      xai: "XAI_API_KEY",
      moonshot: "MOONSHOT_API_KEY",
      openrouter: "OPENROUTER_API_KEY",
    },
    PROVIDER_DISPLAY_NAMES: {
      openai: "OpenAI",
      anthropic: "Anthropic",
      google: "Google",
      groq: "Groq",
      xai: "xAI",
      moonshot: "Moonshot",
      openrouter: "OpenRouter",
    },
  };
});

import { checkAllConfiguredKeys, checkKey } from "./key-validator";

let originalFetch: typeof fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  originalFetch = globalThis.fetch;
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("checkKey", () => {
  it("rejects empty keys without making a request", async () => {
    const out = await checkKey("openai", "");
    expect(out.valid).toBe(false);
    expect(out.error).toContain("empty");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses bearer header and OpenAI URL", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: [{ id: "gpt-5.4" }, { id: "gpt-5.5" }] }),
    );
    const out = await checkKey("openai", "sk-test");
    expect(out.valid).toBe(true);
    expect(out.modelCount).toBe(2);
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("https://api.openai.com/v1/models");
    const headers = (call?.[1] as RequestInit | undefined)?.headers as
      | Record<string, string>
      | undefined;
    expect(headers?.["Authorization"]).toBe("Bearer sk-test");
  });

  it("uses x-api-key header for Anthropic", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }));
    const out = await checkKey("anthropic", "sk-ant-key");
    expect(out.valid).toBe(true);
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit)
      .headers as Record<string, string>;
    expect(headers?.["x-api-key"]).toBe("sk-ant-key");
    expect(headers?.["anthropic-version"]).toBeDefined();
  });

  it("uses query-string key for Google", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ models: [{ name: "m1" }] }));
    const out = await checkKey("google", "abc:1/2");
    expect(out.valid).toBe(true);
    expect(out.modelCount).toBe(1);
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain(
      "https://generativelanguage.googleapis.com/v1beta/models?key=",
    );
    expect(url).toContain(encodeURIComponent("abc:1/2"));
  });

  it("uses auth/key endpoint for OpenRouter", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { label: "ok" } }));
    const out = await checkKey("openrouter", "or-key");
    expect(out.valid).toBe(true);
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toBe("https://openrouter.ai/api/v1/auth/key");
  });

  it("returns invalid when API responds 401", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("nope", { status: 401, statusText: "Unauthorized" }),
    );
    const out = await checkKey("groq", "bad-key");
    expect(out.valid).toBe(false);
    expect(out.error).toContain("401");
  });

  it("returns invalid on network errors with reason", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const out = await checkKey("xai", "x-key");
    expect(out.valid).toBe(false);
    expect(out.error).toContain("ECONNREFUSED");
  });

  it("reports HTTP code for non-401 errors", async () => {
    fetchMock.mockResolvedValueOnce(new Response("err", { status: 500 }));
    const out = await checkKey("moonshot", "k");
    expect(out.valid).toBe(false);
    expect(out.error).toBe("HTTP 500");
  });
});

describe("checkAllConfiguredKeys", () => {
  it("returns empty when nothing configured", async () => {
    mockGetAvailableProviders.mockReturnValueOnce([]);
    const out = await checkAllConfiguredKeys();
    expect(out).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks each configured provider", async () => {
    mockGetAvailableProviders.mockReturnValueOnce(["openai", "anthropic"]);
    mockGetKey.mockImplementation((p: string) =>
      p === "openai" ? "k-oai" : "k-ant",
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }));
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 401 }));
    const out = await checkAllConfiguredKeys();
    expect(out).toHaveLength(2);
    const openai = out.find((r) => r.provider === "openai");
    const anthropic = out.find((r) => r.provider === "anthropic");
    expect(openai?.valid).toBe(true);
    expect(anthropic?.valid).toBe(false);
  });
});
