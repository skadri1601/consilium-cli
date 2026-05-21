import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const TMP_HOME = vi.hoisted(() => {
  const base =
    process.env.TEMP || process.env.TMPDIR || process.env.TMP || "/tmp";
  return base.replace(/\\/g, "/") + `/consilium-perm-test-${process.pid}`;
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

const PERM_DIR = TMP_HOME + "/.consilium";

function cleanup() {
  if (fs.existsSync(PERM_DIR)) {
    fs.rmSync(PERM_DIR, { recursive: true, force: true });
  }
}

let mod: typeof import("../utils/codebase-permissions");

beforeEach(async () => {
  cleanup();
  vi.resetModules();
  mod = await import("../utils/codebase-permissions");
});

afterEach(() => {
  cleanup();
});

const TEST_PATH = "/projects/test-repo";

describe("hasCodebasePermission", () => {
  it("returns null when unset", () => {
    expect(mod.hasCodebasePermission(TEST_PATH)).toBeNull();
  });

  it("returns true when granted", () => {
    mod.grantCodebasePermission(TEST_PATH, "always");
    expect(mod.hasCodebasePermission(TEST_PATH)).toBe(true);
  });

  it("returns false when denied", () => {
    mod.grantCodebasePermission(TEST_PATH, "deny");
    expect(mod.hasCodebasePermission(TEST_PATH)).toBe(false);
  });
});

describe("grantCodebasePermission", () => {
  it("persists always permission to disk", () => {
    mod.grantCodebasePermission(TEST_PATH, "always");
    const raw = JSON.parse(
      fs.readFileSync(path.join(PERM_DIR, "permissions.json"), "utf-8"),
    );
    const normalized = path.resolve(TEST_PATH);
    expect(raw.projects[normalized]?.readCodebase).toBe("always");
  });

  it("stores session permission in memory only", () => {
    mod.grantCodebasePermission(TEST_PATH, "session");
    expect(mod.getCodebasePermissionLevel(TEST_PATH)).toBe("session");
    const permFile = path.join(PERM_DIR, "permissions.json");
    if (fs.existsSync(permFile)) {
      const raw = JSON.parse(fs.readFileSync(permFile, "utf-8"));
      const normalized = path.resolve(TEST_PATH);
      expect(raw.projects[normalized]?.readCodebase).toBeUndefined();
    }
  });
});

describe("revokeCodebasePermission", () => {
  it("removes all permissions for a path", () => {
    mod.grantCodebasePermission(TEST_PATH, "always");
    expect(mod.hasCodebasePermission(TEST_PATH)).toBe(true);
    mod.revokeCodebasePermission(TEST_PATH);
    expect(mod.hasCodebasePermission(TEST_PATH)).toBeNull();
  });

  it("clears all permissions when called without argument", () => {
    mod.grantCodebasePermission(TEST_PATH, "always");
    mod.grantCodebasePermission("/other/path", "always");
    mod.revokeCodebasePermission();
    expect(mod.hasCodebasePermission(TEST_PATH)).toBeNull();
    expect(mod.hasCodebasePermission("/other/path")).toBeNull();
  });
});

describe("getCodebasePermissionLevel", () => {
  it("returns unset for unknown path", () => {
    expect(mod.getCodebasePermissionLevel(TEST_PATH)).toBe("unset");
  });

  it("returns always after granting always", () => {
    mod.grantCodebasePermission(TEST_PATH, "always");
    expect(mod.getCodebasePermissionLevel(TEST_PATH)).toBe("always");
  });

  it("returns session after granting session", () => {
    mod.grantCodebasePermission(TEST_PATH, "session");
    expect(mod.getCodebasePermissionLevel(TEST_PATH)).toBe("session");
  });

  it("returns deny after granting deny", () => {
    mod.grantCodebasePermission(TEST_PATH, "deny");
    expect(mod.getCodebasePermissionLevel(TEST_PATH)).toBe("deny");
  });
});

describe("requestCodebasePermission", () => {
  it("returns true silently when already stored", async () => {
    mod.grantCodebasePermission(TEST_PATH, "always");
    const logSpy = vi.spyOn(console, "log");
    const result = await mod.requestCodebasePermission(TEST_PATH);
    expect(result).toBe(true);
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("returns false when denied", async () => {
    mod.grantCodebasePermission(TEST_PATH, "deny");
    const result = await mod.requestCodebasePermission(TEST_PATH);
    expect(result).toBe(false);
  });
});

describe("getPermissionSnapshot", () => {
  it("returns both read and write levels", () => {
    const snap = mod.getPermissionSnapshot(TEST_PATH);
    expect(snap).toHaveProperty("readCodebase");
    expect(snap).toHaveProperty("writeFiles");
    expect(snap).toHaveProperty("scopePath");
  });

  it("reflects granted read permission", () => {
    mod.grantCodebasePermission(TEST_PATH, "always");
    const snap = mod.getPermissionSnapshot(TEST_PATH);
    expect(snap.readCodebase).toBe("always");
    expect(snap.writeFiles).toBe("unset");
  });

  it("returns unset for both when no permissions", () => {
    const snap = mod.getPermissionSnapshot(TEST_PATH);
    expect(snap.readCodebase).toBe("unset");
    expect(snap.writeFiles).toBe("unset");
  });
});

describe("write permissions", () => {
  it("one-time write permission is consumed after use", () => {
    const normalized = path.resolve(TEST_PATH);
    expect(mod.getWritePermissionLevel(TEST_PATH)).toBe("unset");
    expect(mod.consumeWritePermission(TEST_PATH)).toBe(false);
  });

  it("session write permission reflected via snapshot", () => {
    mod.grantCodebasePermission(TEST_PATH, "always");
    const snap = mod.getPermissionSnapshot(TEST_PATH);
    expect(snap.readCodebase).toBe("always");
  });

  it("always write permission persists to disk", () => {
    const permFile = path.join(PERM_DIR, "permissions.json");
    fs.mkdirSync(PERM_DIR, { recursive: true });
    const normalized = path.resolve(TEST_PATH);
    const store = {
      version: 2,
      projects: {
        [normalized]: {
          writeFiles: "always",
          grantedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    };
    fs.writeFileSync(permFile, JSON.stringify(store), "utf-8");
    expect(mod.getWritePermissionLevel(TEST_PATH)).toBe("always");
    expect(mod.consumeWritePermission(TEST_PATH)).toBe(true);
    expect(mod.getWritePermissionLevel(TEST_PATH)).toBe("always");
  });

  it("revokeWritePermission sets write to deny", () => {
    const permFile = path.join(PERM_DIR, "permissions.json");
    fs.mkdirSync(PERM_DIR, { recursive: true });
    const normalized = path.resolve(TEST_PATH);
    const store = {
      version: 2,
      projects: {
        [normalized]: {
          writeFiles: "always",
          grantedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    };
    fs.writeFileSync(permFile, JSON.stringify(store), "utf-8");
    mod.revokeWritePermission(TEST_PATH);
    expect(mod.getWritePermissionLevel(TEST_PATH)).toBe("deny");
  });
});
