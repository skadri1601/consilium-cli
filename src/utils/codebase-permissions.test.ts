import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const TMP_HOME = vi.hoisted(() => {
  const base =
    process.env.TEMP || process.env.TMPDIR || process.env.TMP || "/tmp";
  return base.replace(/\\/g, "/") + `/consilium-codeperm-test-${process.pid}`;
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

function writeRules(rules: {
  allow?: string[];
  deny?: string[];
  ask?: string[];
}): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(CONFIG_DIR, "permissions.json"),
    JSON.stringify({
      version: 2,
      projects: {},
      rules: {
        allow: rules.allow ?? [],
        deny: rules.deny ?? [],
        ask: rules.ask ?? [],
      },
    }),
    "utf-8",
  );
}

let mod: typeof import("./codebase-permissions");
let modesMod: typeof import("./permission-modes");
let planMod: typeof import("./plan-mode");

beforeEach(async () => {
  cleanup();
  vi.resetModules();
  delete process.env.CONSILIUM_PERMISSION_MODE;
  delete process.env.CONSILIUM_ALLOW_BYPASS;
  delete process.env.CONSILIUM_PLAN_MODE;
  mod = await import("./codebase-permissions");
  modesMod = await import("./permission-modes");
  planMod = await import("./plan-mode");
  mod._resetPermissionNoticesForTests();
  modesMod._resetPermissionModeForTests();
  planMod._resetForTests();
});

afterEach(() => {
  if (modesMod) modesMod._resetPermissionModeForTests();
  if (planMod) planMod._resetForTests();
  cleanup();
});

describe("requestCodebasePermission (grammar)", () => {
  it("returns true without prompting when allow rule matches", async () => {
    const target = path.resolve("/tmp/consilium-grant-allow");
    writeRules({ allow: [`Read(${target})`] });
    const result = await mod.requestCodebasePermission(target);
    expect(result).toBe(true);
  });

  it("returns false without prompting when deny rule matches", async () => {
    const target = path.resolve("/tmp/consilium-grant-deny");
    writeRules({ deny: [`Read(${target})`] });
    const result = await mod.requestCodebasePermission(target);
    expect(result).toBe(false);
  });
});

describe("requestWritePermission (mode gating)", () => {
  it("denies with [PLAN MODE] message when mode=plan", async () => {
    const target = path.resolve("/tmp/consilium-write-plan");
    modesMod.setMode("plan");
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const prevTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      get: () => true,
    });

    const result = await mod.requestWritePermission(target);
    expect(result).toBe("deny");

    const wrote = stdoutSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(wrote).toMatch(/\[PLAN MODE\]/);

    stdoutSpy.mockRestore();
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: prevTTY,
    });
  });

  it("allows without prompting when mode=bypass and CONSILIUM_ALLOW_BYPASS=1", async () => {
    const target = path.resolve("/tmp/consilium-write-bypass");
    process.env.CONSILIUM_ALLOW_BYPASS = "1";
    modesMod.setMode("bypass");
    const result = await mod.requestWritePermission(target);
    expect(result).toBe("always");
  });
});
