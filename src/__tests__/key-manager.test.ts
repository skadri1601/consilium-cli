import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";

const TMP_HOME = vi.hoisted(() => {
  const base =
    process.env.TEMP || process.env.TMPDIR || process.env.TMP || "/tmp";
  return base.replace(/\\/g, "/") + `/consilium-km-test-${process.pid}`;
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

function clearConfigDir() {
  if (fs.existsSync(CONFIG_DIR)) {
    fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
  }
}

import { KeyManager, Provider } from "../utils/key-manager";

let km: KeyManager;

beforeEach(() => {
  clearConfigDir();
  vi.unstubAllEnvs();
  km = new KeyManager();
});

afterEach(() => {
  clearConfigDir();
  vi.unstubAllEnvs();
});

describe("getKey", () => {
  it("returns env var value when set", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-env-test-key");
    expect(km.getKey("openai")).toBe("sk-env-test-key");
  });

  it("returns config value when no env var", () => {
    writeConfig({ providerKeys: { anthropic: "sk-config-key" } });
    expect(km.getKey("anthropic")).toBe("sk-config-key");
  });

  it("returns undefined when no key anywhere", () => {
    writeConfig({});
    expect(km.getKey("groq")).toBeUndefined();
  });

  it("prefers env var over config value", () => {
    vi.stubEnv("GROQ_API_KEY", "sk-env-groq");
    writeConfig({ providerKeys: { groq: "sk-config-groq" } });
    expect(km.getKey("groq")).toBe("sk-env-groq");
  });
});

describe("setKey", () => {
  it("persists key to config", () => {
    writeConfig({});
    km.setKey("openai", "sk-new-key");
    expect(km.getKey("openai")).toBe("sk-new-key");
  });

  it("overwrites existing key", () => {
    writeConfig({ providerKeys: { openai: "sk-old" } });
    km.setKey("openai", "sk-new");
    expect(km.getKey("openai")).toBe("sk-new");
  });
});

describe("removeKey", () => {
  it("removes key from config", () => {
    writeConfig({ providerKeys: { openai: "sk-remove-me" } });
    km.removeKey("openai");
    expect(km.getKey("openai")).toBeUndefined();
  });

  it("no error when removing nonexistent key", () => {
    writeConfig({});
    expect(() => km.removeKey("google")).not.toThrow();
  });
});

describe("listKeys", () => {
  it("lists env-sourced keys", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-anthro-env");
    writeConfig({});
    const keys = km.listKeys();
    const entry = keys.find((k) => k.provider === "anthropic");
    expect(entry).toBeDefined();
    expect(entry!.source).toBe("env");
  });

  it("lists config-sourced keys", () => {
    writeConfig({ providerKeys: { google: "sk-google-cfg-key-1234" } });
    const keys = km.listKeys();
    const entry = keys.find((k) => k.provider === "google");
    expect(entry).toBeDefined();
    expect(entry!.source).toBe("config");
  });

  it("returns empty when no keys set", () => {
    writeConfig({});
    expect(km.listKeys()).toHaveLength(0);
  });

  it("env takes priority over config in listing", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-env-openai");
    writeConfig({ providerKeys: { openai: "sk-cfg-openai" } });
    const keys = km.listKeys();
    const entry = keys.find((k) => k.provider === "openai");
    expect(entry!.source).toBe("env");
  });
});

describe("hasKey", () => {
  it("returns true when env var set", () => {
    vi.stubEnv("GROQ_API_KEY", "sk-groq");
    expect(km.hasKey("groq")).toBe(true);
  });

  it("returns true when config key set", () => {
    writeConfig({ providerKeys: { xai: "sk-xai" } });
    expect(km.hasKey("xai")).toBe(true);
  });

  it("returns false when no key", () => {
    writeConfig({});
    expect(km.hasKey("moonshot")).toBe(false);
  });
});

describe("getAvailableProviders", () => {
  it("returns providers with keys set", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-openai");
    writeConfig({ providerKeys: { groq: "sk-groq" } });
    const providers = km.getAvailableProviders();
    expect(providers).toContain("openai");
    expect(providers).toContain("groq");
    expect(providers).not.toContain("anthropic");
  });

  it("returns empty when no keys", () => {
    writeConfig({});
    expect(km.getAvailableProviders()).toHaveLength(0);
  });
});

describe("resolveKeysForModels", () => {
  it("maps groq model to groq provider key", () => {
    vi.stubEnv("GROQ_API_KEY", "sk-groq-key");
    const result = km.resolveKeysForModels(["llama-3.3-70b-versatile"]);
    expect(result.get("llama-3.3-70b-versatile")).toBe("sk-groq-key");
  });

  it("maps openai model to openai provider key", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-openai-key");
    const result = km.resolveKeysForModels(["gpt-5.4-mini"]);
    expect(result.get("gpt-5.4-mini")).toBe("sk-openai-key");
  });

  it("returns undefined for unknown model", () => {
    writeConfig({});
    const result = km.resolveKeysForModels(["unknown-model-xyz"]);
    expect(result.get("unknown-model-xyz")).toBeUndefined();
  });

  it("resolves multiple models at once", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-openai");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-anthro");
    const result = km.resolveKeysForModels(["gpt-5.4", "claude-sonnet-4-6"]);
    expect(result.get("gpt-5.4")).toBe("sk-openai");
    expect(result.get("claude-sonnet-4-6")).toBe("sk-anthro");
  });
});

describe("getJudgeProvider", () => {
  it("picks non-debate provider first", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-anthro");
    vi.stubEnv("GOOGLE_API_KEY", "sk-google");
    const judge = km.getJudgeProvider(["gpt-5.4"]);
    expect(judge).toBe("anthropic");
  });

  it("falls back to debate provider when no alternative", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-anthro");
    writeConfig({});
    const judge = km.getJudgeProvider(["claude-sonnet-4-6"]);
    expect(judge).toBe("anthropic");
  });

  it("returns undefined when no keys at all", () => {
    writeConfig({});
    expect(km.getJudgeProvider(["gpt-5.4"])).toBeUndefined();
  });

  it("skips debate providers in first pass", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-openai");
    vi.stubEnv("GOOGLE_API_KEY", "sk-google");
    const judge = km.getJudgeProvider(["gpt-5.4"]);
    expect(judge).toBe("google");
    expect(judge).not.toBe("openai");
  });
});

describe("maskKey", () => {
  it("masks long keys showing first and last 4 chars", () => {
    writeConfig({ providerKeys: { openai: "sk-abcdefghijklmnop" } });
    const keys = km.listKeys();
    const entry = keys.find((k) => k.provider === "openai");
    expect(entry!.masked).toBe("sk-a...mnop");
  });

  it("masks short keys completely", () => {
    writeConfig({ providerKeys: { openai: "short" } });
    const keys = km.listKeys();
    const entry = keys.find((k) => k.provider === "openai");
    expect(entry!.masked).toBe("****");
  });

  it("masks keys of exactly 8 chars", () => {
    writeConfig({ providerKeys: { openai: "12345678" } });
    const keys = km.listKeys();
    const entry = keys.find((k) => k.provider === "openai");
    expect(entry!.masked).toBe("****");
  });

  it("masks keys of 9 chars showing first/last 4", () => {
    writeConfig({ providerKeys: { openai: "123456789" } });
    const keys = km.listKeys();
    const entry = keys.find((k) => k.provider === "openai");
    expect(entry!.masked).toBe("1234...6789");
  });
});
