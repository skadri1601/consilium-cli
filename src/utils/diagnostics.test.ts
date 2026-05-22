import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockLoadConfig,
  mockCheckAllConfiguredKeys,
  mockGetAvailableProviders,
  mockGetKey,
  mockIsSchedulerRunning,
  mockListAgents,
  mockExistsSync,
  mockReaddirSync,
  mockLstatSync,
} = vi.hoisted(() => ({
  mockLoadConfig: vi.fn(),
  mockCheckAllConfiguredKeys: vi.fn(),
  mockGetAvailableProviders: vi.fn(),
  mockGetKey: vi.fn(),
  mockIsSchedulerRunning: vi.fn(),
  mockListAgents: vi.fn(),
  mockExistsSync: vi.fn(),
  mockReaddirSync: vi.fn(),
  mockLstatSync: vi.fn(),
}));

vi.mock("./config", () => ({
  loadConfig: mockLoadConfig,
  DEFAULT_API_ORIGIN: "https://api.myconsilium.xyz",
}));

vi.mock("./key-manager", () => {
  class KeyManager {
    getAvailableProviders = mockGetAvailableProviders;
    getKey = mockGetKey;
  }
  return {
    KeyManager,
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

vi.mock("./key-validator", () => ({
  checkAllConfiguredKeys: mockCheckAllConfiguredKeys,
}));

vi.mock("./scheduler-daemon", () => ({
  isSchedulerRunning: mockIsSchedulerRunning,
}));

vi.mock("./agent-registry", () => ({
  listAgents: mockListAgents,
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: mockExistsSync,
      readdirSync: mockReaddirSync,
      lstatSync: mockLstatSync,
    },
    existsSync: mockExistsSync,
    readdirSync: mockReaddirSync,
    lstatSync: mockLstatSync,
  };
});

import { renderDiagnostics, runDiagnostics } from "./diagnostics";

let originalFetch: typeof fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadConfig.mockReturnValue({
    apiUrl: "https://api.test.example",
  });
  mockCheckAllConfiguredKeys.mockResolvedValue([]);
  mockGetAvailableProviders.mockReturnValue([]);
  mockIsSchedulerRunning.mockReturnValue(false);
  mockListAgents.mockReturnValue([]);
  mockExistsSync.mockReturnValue(false);
  mockReaddirSync.mockReturnValue([]);
  mockLstatSync.mockImplementation(() => {
    throw new Error("not stubbed");
  });
  originalFetch = globalThis.fetch;
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("runDiagnostics", () => {
  it("returns system + api + key + scheduler + storage fields", async () => {
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    mockGetAvailableProviders.mockReturnValue(["openai"]);
    mockCheckAllConfiguredKeys.mockResolvedValueOnce([
      { provider: "openai", valid: true, modelCount: 5 },
    ]);
    mockIsSchedulerRunning.mockReturnValue(true);
    mockListAgents.mockReturnValue([{ id: "a1" }, { id: "a2" }]);

    const result = await runDiagnostics();

    expect(result.system.nodeVersion).toBe(process.version);
    expect(result.system.os).toBeTruthy();
    expect(result.system.arch).toBeTruthy();
    expect(result.api.reachable).toBe(true);
    expect(result.api.url).toBe("https://api.test.example");
    expect(typeof result.api.latencyMs).toBe("number");
    expect(result.providerKeys).toHaveLength(1);
    expect(result.providerKeys[0]).toMatchObject({
      provider: "openai",
      configured: true,
      valid: true,
    });
    expect(result.schedulerRunning).toBe(true);
    expect(result.agentCount).toBe(2);
    expect(result.diskUsage.configDir).toContain(".consilium");
    expect(result.diskUsage.totalBytes).toBe(0);
  });

  it("marks API unreachable when fetch fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    const result = await runDiagnostics();
    expect(result.api.reachable).toBe(false);
    expect(result.api.error).toContain("ECONNRESET");
  });

  it("marks API unreachable on non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(new Response("err", { status: 503 }));
    const result = await runDiagnostics();
    expect(result.api.reachable).toBe(false);
    expect(result.api.error).toContain("503");
  });

  it("reports session count from disk listing", async () => {
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    mockExistsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      return s.endsWith("sessions") || s.endsWith(".consilium");
    });
    mockReaddirSync.mockImplementation((p: unknown) => {
      if (String(p).endsWith("sessions")) {
        return ["s1.json", "s2.json", "notes.txt"];
      }
      return [];
    });
    const result = await runDiagnostics();
    expect(result.sessionCount).toBe(2);
  });
});

describe("renderDiagnostics", () => {
  it("includes labeled sections", async () => {
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const result = await runDiagnostics();
    const text = renderDiagnostics(result);
    expect(text).toContain("Consilium CLI doctor");
    expect(text).toContain("System");
    expect(text).toContain("API");
    expect(text).toContain("Provider keys");
    expect(text).toContain("Autonomy");
    expect(text).toContain("Storage");
  });

  it("notes when API is unreachable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    const result = await runDiagnostics();
    const text = renderDiagnostics(result);
    expect(text).toContain("Reachable:");
    expect(text).toContain("no");
  });
});
