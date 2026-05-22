import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadHooks,
  loadConsiliumSettings,
  getEntriesForEvent,
  getHooksConfigPath,
  getConsiliumConfigPath,
} from "./loader";
import type { HookConfig } from "./types";

let tmpDir: string;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "consilium-loader-"));
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("getHooksConfigPath / getConsiliumConfigPath", () => {
  it("returns paths under the user's .consilium directory", () => {
    expect(getHooksConfigPath()).toContain(os.homedir());
    expect(getHooksConfigPath()).toContain(".consilium");
    expect(getHooksConfigPath()).toMatch(/hooks\.json$/);
    expect(getConsiliumConfigPath()).toMatch(/config\.json$/);
  });
});

describe("loadHooks", () => {
  it("returns empty hooks when file does not exist", () => {
    const config = loadHooks(path.join(tmpDir, "missing.json"));
    expect(config).toEqual({ hooks: {} });
  });

  function fullHooks(
    partial: Record<string, unknown[]>,
  ): Record<string, unknown[]> {
    const all: Record<string, unknown[]> = {
      SessionStart: [],
      SessionEnd: [],
      PreToolUse: [],
      PostToolUse: [],
      UserPromptSubmit: [],
      Stop: [],
      PermissionRequest: [],
    };
    return { ...all, ...partial };
  }

  it("loads a valid command hook entry", () => {
    const file = path.join(tmpDir, "hooks.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        hooks: fullHooks({
          SessionStart: [{ type: "command", command: "echo hi" }],
        }),
      }),
      "utf-8",
    );
    const config = loadHooks(file);
    expect(config.hooks.SessionStart).toHaveLength(1);
    expect(config.hooks.SessionStart?.[0]).toMatchObject({
      type: "command",
      command: "echo hi",
    });
  });

  it("loads a valid http hook entry", () => {
    const file = path.join(tmpDir, "hooks.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        hooks: fullHooks({
          Stop: [
            {
              type: "http",
              url: "https://hooks.example.com/end",
              method: "POST",
            },
          ],
        }),
      }),
      "utf-8",
    );
    const config = loadHooks(file);
    expect(config.hooks.Stop).toHaveLength(1);
    expect(config.hooks.Stop?.[0]).toMatchObject({
      type: "http",
      url: "https://hooks.example.com/end",
    });
  });

  it("returns empty hooks and warns when JSON is invalid", () => {
    const file = path.join(tmpDir, "hooks.json");
    fs.writeFileSync(file, "{not valid json", "utf-8");
    const config = loadHooks(file);
    expect(config).toEqual({ hooks: {} });
    expect(warnSpy).toHaveBeenCalled();
  });

  it("returns empty hooks and warns when schema is invalid", () => {
    const file = path.join(tmpDir, "hooks.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        hooks: fullHooks({
          SessionStart: [{ type: "command" }], // missing command
        }),
      }),
      "utf-8",
    );
    const config = loadHooks(file);
    expect(config).toEqual({ hooks: {} });
    expect(warnSpy).toHaveBeenCalled();
  });

  it("rejects unknown event names via schema", () => {
    const file = path.join(tmpDir, "hooks.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        hooks: {
          UnknownEvent: [{ type: "command", command: "x" }],
        },
      }),
      "utf-8",
    );
    const config = loadHooks(file);
    expect(config).toEqual({ hooks: {} });
    expect(warnSpy).toHaveBeenCalled();
  });

  it("rejects http entries with a non-URL string", () => {
    const file = path.join(tmpDir, "hooks.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        hooks: fullHooks({
          Stop: [{ type: "http", url: "not-a-url" }],
        }),
      }),
      "utf-8",
    );
    const config = loadHooks(file);
    expect(config).toEqual({ hooks: {} });
  });
});

describe("loadConsiliumSettings", () => {
  it("returns defaults when file does not exist", () => {
    const settings = loadConsiliumSettings(path.join(tmpDir, "missing.json"));
    expect(settings).toEqual({ hooksEnabled: false, allowedHookUrls: [] });
  });

  it("reads hooksEnabled and allowedHookUrls from config", () => {
    const file = path.join(tmpDir, "config.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        hooksEnabled: true,
        allowedHookUrls: ["https://h.test/x"],
        otherField: "ignored",
      }),
      "utf-8",
    );
    const settings = loadConsiliumSettings(file);
    expect(settings.hooksEnabled).toBe(true);
    expect(settings.allowedHookUrls).toEqual(["https://h.test/x"]);
  });

  it("returns defaults on malformed JSON", () => {
    const file = path.join(tmpDir, "config.json");
    fs.writeFileSync(file, "{not json", "utf-8");
    const settings = loadConsiliumSettings(file);
    expect(settings).toEqual({ hooksEnabled: false, allowedHookUrls: [] });
  });

  it("returns defaults when schema is invalid", () => {
    const file = path.join(tmpDir, "config.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ hooksEnabled: "yes", allowedHookUrls: "no" }),
      "utf-8",
    );
    const settings = loadConsiliumSettings(file);
    expect(settings).toEqual({ hooksEnabled: false, allowedHookUrls: [] });
  });
});

describe("getEntriesForEvent", () => {
  it("returns entries when event has them", () => {
    const config: HookConfig = {
      hooks: {
        SessionStart: [{ type: "command", command: "echo" }],
      },
    };
    expect(getEntriesForEvent(config, "SessionStart")).toHaveLength(1);
  });

  it("returns empty array when event has no entries", () => {
    const config: HookConfig = { hooks: {} };
    expect(getEntriesForEvent(config, "Stop")).toEqual([]);
  });
});
