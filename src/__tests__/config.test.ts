import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = vi.hoisted(() => {
  const base =
    process.env.TEMP || process.env.TMPDIR || process.env.TMP || "/tmp";
  return base.replace(/\\/g, "/") + `/consilium-test-${process.pid}`;
});

vi.mock("node:os", () => ({
  default: {
    homedir: () => TMP_HOME,
    tmpdir: () =>
      process.env.TEMP || process.env.TMPDIR || process.env.TMP || "/tmp",
  },
  homedir: () => TMP_HOME,
  tmpdir: () =>
    process.env.TEMP || process.env.TMPDIR || process.env.TMP || "/tmp",
}));

const CONFIG_DIR = TMP_HOME + "/.consilium";
const CONFIG_FILE = CONFIG_DIR + "/config.json";

function writeConfig(data: object) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data), "utf-8");
}

function clearConfigFile() {
  if (fs.existsSync(CONFIG_DIR)) {
    fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
  }
}

import {
  loadConfig,
  saveConfig,
  updateConfig,
  getConfigValue,
  listConfig,
  isLoggedIn,
  clearAuth,
  getCachedPreferences,
  getPreferences,
  fetchAndCachePreferences,
  DEFAULT_API_ORIGIN,
  DEFAULT_WEB_ORIGIN,
} from "../utils/config";

beforeEach(() => {
  clearConfigFile();
  vi.unstubAllEnvs();
});

afterEach(() => {
  clearConfigFile();
  vi.unstubAllEnvs();
});

describe("loadConfig", () => {
  it("returns defaults when no config file exists", () => {
    const cfg = loadConfig();
    expect(cfg.apiUrl).toBe(DEFAULT_API_ORIGIN);
    expect(cfg.webUrl).toBe(DEFAULT_WEB_ORIGIN);
    expect(cfg.debug).toBe(false);
  });

  it("merges file config over defaults", () => {
    writeConfig({ apiKey: "consilium_testkey12345678", userName: "Test User" });
    const cfg = loadConfig();
    expect(cfg.apiKey).toBe("consilium_testkey12345678");
    expect(cfg.userName).toBe("Test User");
    expect(cfg.apiUrl).toBe(DEFAULT_API_ORIGIN);
  });

  it("respects CONSILIUM_API_URL env var", () => {
    vi.stubEnv("CONSILIUM_API_URL", "http://localhost:3000");
    const cfg = loadConfig();
    expect(cfg.apiUrl).toBe("http://localhost:3000");
  });

  it("sets debug=true when CONSILIUM_DEBUG=1", () => {
    vi.stubEnv("CONSILIUM_DEBUG", "1");
    const cfg = loadConfig();
    expect(cfg.debug).toBe(true);
  });

  it("returns defaults when config file is malformed JSON", () => {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, "not json", "utf-8");
    const cfg = loadConfig();
    expect(cfg.apiUrl).toBe(DEFAULT_API_ORIGIN);
  });
});

describe("saveConfig / updateConfig / getConfigValue", () => {
  it("persists and retrieves a value", () => {
    saveConfig({
      apiKey: "consilium_abc123456789",
      apiUrl: DEFAULT_API_ORIGIN,
    });
    const val = getConfigValue("apiKey");
    expect(val).toBe("consilium_abc123456789");
  });

  it("updateConfig merges with existing config", () => {
    writeConfig({ apiKey: "consilium_old1234567" });
    updateConfig("apiUrl", "https://example.com");
    const cfg = loadConfig();
    expect(cfg.apiKey).toBe("consilium_old1234567");
    expect(cfg.apiUrl).toBe("https://example.com");
  });

  it("updateConfig rejects keys outside the allowlist", () => {
    writeConfig({ apiKey: "consilium_old1234567" });
    expect(() => updateConfig("userName", "Alice")).toThrow(
      /Unknown config key/,
    );
  });
});

describe("listConfig", () => {
  it("returns current config", () => {
    writeConfig({ apiKey: "consilium_list1234567" });
    const cfg = listConfig();
    expect(cfg.apiKey).toBe("consilium_list1234567");
  });
});

describe("isLoggedIn", () => {
  it("returns false when no apiKey", () => {
    expect(isLoggedIn()).toBe(false);
  });

  it("returns false for malformed token", () => {
    writeConfig({ apiKey: "badtoken" });
    expect(isLoggedIn()).toBe(false);
  });

  it("returns true for valid consilium_ token", () => {
    writeConfig({ apiKey: "consilium_validtoken12345" });
    expect(isLoggedIn()).toBe(true);
  });
});

describe("clearAuth", () => {
  it("removes apiKey, userName, userEmail but preserves apiUrl", () => {
    writeConfig({
      apiKey: "consilium_clearme12345",
      userName: "Alice",
      userEmail: "alice@example.com",
      apiUrl: DEFAULT_API_ORIGIN,
    });
    clearAuth();
    const cfg = loadConfig();
    expect(cfg.apiKey).toBeUndefined();
    expect(cfg.userName).toBeUndefined();
    expect(cfg.userEmail).toBeUndefined();
    expect(cfg.apiUrl).toBe(DEFAULT_API_ORIGIN);
  });

  it("also clears cached preferences", () => {
    writeConfig({
      apiKey: "consilium_clearme12345",
      userName: "Alice",
      preferences: { defaultAgents: ["gpt-5.4"], defaultMode: "council" },
    });
    clearAuth();
    const cfg = loadConfig();
    expect(cfg.preferences).toBeUndefined();
  });
});

describe("getCachedPreferences", () => {
  it("returns null when no preferences are cached", () => {
    writeConfig({ apiKey: "consilium_test12345678" });
    expect(getCachedPreferences()).toBeNull();
  });

  it("returns null when preferences has empty defaultAgents", () => {
    writeConfig({
      apiKey: "consilium_test12345678",
      preferences: { defaultAgents: [], defaultMode: "auto" },
    });
    expect(getCachedPreferences()).toBeNull();
  });

  it("returns preferences when cached with non-empty defaultAgents", () => {
    const prefs = {
      defaultAgents: ["gpt-5.4", "claude-sonnet-4-6"],
      defaultMode: "council",
    };
    writeConfig({ apiKey: "consilium_test12345678", preferences: prefs });
    const result = getCachedPreferences();
    expect(result).toEqual(prefs);
  });
});

describe("getPreferences", () => {
  it("returns cached prefs if available", async () => {
    const prefs = { defaultAgents: ["gpt-5.4"], defaultMode: "deep" };
    writeConfig({ apiKey: "consilium_test12345678", preferences: prefs });
    const result = await getPreferences();
    expect(result).toEqual(prefs);
  });

  it("calls fetchAndCachePreferences when no cached prefs", async () => {
    writeConfig({ apiKey: "consilium_test12345678" });
    const mockPrefs = {
      defaultAgents: ["gemini-3-flash-preview"],
      defaultMode: "quick",
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockPrefs,
    } as Response);
    const result = await getPreferences();
    expect(result).toEqual(mockPrefs);
    vi.restoreAllMocks();
  });

  it("returns empty defaults on failure", async () => {
    writeConfig({ apiKey: "consilium_test12345678" });
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("network error"),
    );
    const result = await getPreferences();
    expect(result).toEqual({ defaultAgents: [], defaultMode: "auto" });
    vi.restoreAllMocks();
  });
});

describe("fetchAndCachePreferences", () => {
  it("returns null when no apiKey", async () => {
    writeConfig({});
    const result = await fetchAndCachePreferences();
    expect(result).toBeNull();
  });

  it("fetches and caches preferences on success", async () => {
    writeConfig({
      apiKey: "consilium_test12345678",
      apiUrl: DEFAULT_API_ORIGIN,
    });
    const mockPrefs = { defaultAgents: ["gpt-5.4"], defaultMode: "council" };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockPrefs,
    } as Response);
    const result = await fetchAndCachePreferences();
    expect(result).toEqual(mockPrefs);
    const cfg = loadConfig();
    expect(cfg.preferences).toEqual(mockPrefs);
    vi.restoreAllMocks();
  });

  it("returns null on non-ok response", async () => {
    writeConfig({ apiKey: "consilium_test12345678" });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 401,
    } as Response);
    const result = await fetchAndCachePreferences();
    expect(result).toBeNull();
    vi.restoreAllMocks();
  });

  it("returns null on network error", async () => {
    writeConfig({ apiKey: "consilium_test12345678" });
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("timeout"));
    const result = await fetchAndCachePreferences();
    expect(result).toBeNull();
    vi.restoreAllMocks();
  });

  it("returns null when response missing required fields", async () => {
    writeConfig({ apiKey: "consilium_test12345678" });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        defaultAgents: "not-an-array",
        defaultMode: "council",
      }),
    } as Response);
    const result = await fetchAndCachePreferences();
    expect(result).toBeNull();
    vi.restoreAllMocks();
  });
});
