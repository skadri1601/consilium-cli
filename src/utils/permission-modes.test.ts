import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const TMP_HOME = vi.hoisted(() => {
  const base =
    process.env.TEMP || process.env.TMPDIR || process.env.TMP || "/tmp";
  return base.replace(/\\/g, "/") + `/consilium-mode-test-${process.pid}`;
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

const CONFIG_DIR = path.join(TMP_HOME, ".consilium");

function cleanup() {
  if (fs.existsSync(CONFIG_DIR)) {
    fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
  }
}

let mod: typeof import("./permission-modes");
let planMod: typeof import("./plan-mode");

beforeEach(async () => {
  cleanup();
  vi.resetModules();
  mod = await import("./permission-modes");
  planMod = await import("./plan-mode");
  mod._resetPermissionModeForTests();
  planMod._resetForTests();
});

afterEach(() => {
  if (mod) mod._resetPermissionModeForTests();
  if (planMod) planMod._resetForTests();
  cleanup();
});

describe("MODE_ORDER", () => {
  it("contains all five modes in expected order", () => {
    expect(mod.MODE_ORDER).toEqual([
      "default",
      "acceptEdits",
      "auto",
      "plan",
      "bypass",
    ]);
  });
});

describe("getCurrentMode / setMode", () => {
  it("returns 'default' when nothing is set", () => {
    expect(mod.getCurrentMode()).toBe("default");
  });

  it("reads from env var when present", () => {
    process.env.CONSILIUM_PERMISSION_MODE = "acceptEdits";
    expect(mod.getCurrentMode()).toBe("acceptEdits");
  });

  it("ignores invalid env values and falls back to default", () => {
    process.env.CONSILIUM_PERMISSION_MODE = "garbage";
    expect(mod.getCurrentMode()).toBe("default");
  });

  it("setMode updates env and persists to config", () => {
    mod.setMode("auto");
    expect(process.env.CONSILIUM_PERMISSION_MODE).toBe("auto");
    const cfg = JSON.parse(
      fs.readFileSync(path.join(CONFIG_DIR, "config.json"), "utf-8"),
    );
    expect(cfg.permissionMode).toBe("auto");
  });

  it("persisted mode is read when env is absent", () => {
    mod.setMode("plan");
    delete process.env.CONSILIUM_PERMISSION_MODE;
    expect(mod.getCurrentMode()).toBe("plan");
  });

  it("setMode rejects invalid modes", () => {
    expect(() => mod.setMode("invalid" as never)).toThrow(/Invalid/);
  });
});

describe("cycleMode", () => {
  it("advances through the mode order", () => {
    mod.setMode("default");
    expect(mod.cycleMode()).toBe("acceptEdits");
    expect(mod.cycleMode()).toBe("auto");
    expect(mod.cycleMode()).toBe("plan");
  });

  it("skips bypass when CONSILIUM_ALLOW_BYPASS is not set", () => {
    mod.setMode("plan");
    expect(mod.cycleMode()).toBe("default");
  });

  it("allows bypass when CONSILIUM_ALLOW_BYPASS=1", () => {
    process.env.CONSILIUM_ALLOW_BYPASS = "1";
    mod.setMode("plan");
    expect(mod.cycleMode()).toBe("bypass");
  });

  it("wraps around back to default after bypass", () => {
    process.env.CONSILIUM_ALLOW_BYPASS = "1";
    mod.setMode("bypass");
    expect(mod.cycleMode()).toBe("default");
  });
});

describe("describeMode", () => {
  it("returns a human description for each mode", () => {
    for (const m of mod.MODE_ORDER) {
      const desc = mod.describeMode(m);
      expect(typeof desc).toBe("string");
      expect(desc.length).toBeGreaterThan(0);
      expect(desc).toContain(m);
    }
  });
});

describe("modeAllowsWrite", () => {
  it("default mode asks", () => {
    expect(mod.modeAllowsWrite("default", process.cwd())).toBe("ask");
    expect(mod.modeAllowsWrite("default", "/elsewhere")).toBe("ask");
  });

  it("acceptEdits allows writes inside cwd", () => {
    const insidePath = path.join(process.cwd(), "src", "x.ts");
    expect(mod.modeAllowsWrite("acceptEdits", insidePath)).toBe("allow");
    expect(mod.modeAllowsWrite("acceptEdits", process.cwd())).toBe("allow");
  });

  it("acceptEdits asks when outside cwd", () => {
    const outside =
      process.platform === "win32" ? "C:/tmp/other.ts" : "/tmp/other.ts";
    expect(mod.modeAllowsWrite("acceptEdits", outside)).toBe("ask");
  });

  it("plan mode denies regardless of scope", () => {
    expect(mod.modeAllowsWrite("plan", process.cwd())).toBe("deny");
    expect(mod.modeAllowsWrite("plan", "/anywhere")).toBe("deny");
  });

  it("plan mode denies even for acceptEdits when planModeActive", () => {
    planMod.enterPlanMode();
    expect(mod.modeAllowsWrite("acceptEdits", process.cwd())).toBe("deny");
  });

  it("CONSILIUM_PLAN_MODE env triggers deny in non-plan modes", () => {
    process.env.CONSILIUM_PLAN_MODE = "1";
    expect(mod.modeAllowsWrite("acceptEdits", process.cwd())).toBe("deny");
  });

  it("bypass mode allows when CONSILIUM_ALLOW_BYPASS=1", () => {
    process.env.CONSILIUM_ALLOW_BYPASS = "1";
    expect(mod.modeAllowsWrite("bypass", "/anywhere")).toBe("allow");
  });

  it("bypass mode falls back to ask when env flag is missing", () => {
    expect(mod.modeAllowsWrite("bypass", "/anywhere")).toBe("ask");
  });

  it("auto mode consults rules and asks when unmatched", () => {
    expect(mod.modeAllowsWrite("auto", "/no/rule/match.txt")).toBe("ask");
  });

  it("auto mode allows when allow rule matches", () => {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(CONFIG_DIR, "permissions.json"),
      JSON.stringify({
        version: 2,
        projects: {},
        rules: { allow: ["Write(/tmp/*)"], deny: [], ask: [] },
      }),
      "utf-8",
    );
    expect(mod.modeAllowsWrite("auto", "/tmp/file.ts")).toBe("allow");
  });
});
