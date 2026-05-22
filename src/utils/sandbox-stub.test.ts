import { describe, it, expect, afterEach } from "vitest";
import {
  isSandboxAvailable,
  runInSandbox,
  describeSandboxStub,
} from "./sandbox-stub";
import {
  __setSandboxDepsForTests,
  __resetSandboxDepsForTests,
} from "./sandbox-native";

afterEach(() => {
  __resetSandboxDepsForTests();
});

describe("sandbox-stub (delegating wrapper)", () => {
  describe("isSandboxAvailable", () => {
    it("returns available=true when native sandbox is detectable (linux+bwrap)", () => {
      __setSandboxDepsForTests({
        platformOverride: "linux",
        which: (cmd) => cmd === "bwrap",
      });
      const result = isSandboxAvailable();
      expect(result.available).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("returns available=true when native sandbox is detectable (darwin+sandbox-exec)", () => {
      __setSandboxDepsForTests({
        platformOverride: "darwin",
        which: (cmd) => cmd === "sandbox-exec",
      });
      const result = isSandboxAvailable();
      expect(result.available).toBe(true);
    });

    it("returns available=false with a helpful reason on Windows", () => {
      __setSandboxDepsForTests({
        platformOverride: "win32",
        which: () => true,
      });
      const result = isSandboxAvailable();
      expect(result.available).toBe(false);
      expect(result.reason).toBeDefined();
      expect(result.reason).toMatch(/Windows|worktree/i);
    });

    it("returns available=false with a tooling-missing reason on Linux without bwrap", () => {
      __setSandboxDepsForTests({
        platformOverride: "linux",
        which: () => false,
      });
      const result = isSandboxAvailable();
      expect(result.available).toBe(false);
      expect(result.reason).toMatch(/bwrap/);
    });
  });

  describe("describeSandboxStub", () => {
    it("returns a non-empty descriptor for both available and unavailable states", () => {
      __setSandboxDepsForTests({
        platformOverride: "linux",
        which: (cmd) => cmd === "bwrap",
      });
      const availableDesc = describeSandboxStub();
      expect(availableDesc.length).toBeGreaterThan(0);
      expect(availableDesc).toMatch(/available|sandbox/i);

      __setSandboxDepsForTests({
        platformOverride: "win32",
        which: () => false,
      });
      const unavailableDesc = describeSandboxStub();
      expect(unavailableDesc.length).toBeGreaterThan(0);
    });
  });

  describe("runInSandbox", () => {
    it("rejects when native sandbox is unavailable (Windows)", async () => {
      __setSandboxDepsForTests({
        platformOverride: "win32",
        which: () => false,
      });
      await expect(runInSandbox("ls", ["-la"])).rejects.toThrow();
    });

    it("rejects when tooling is missing (Linux without bwrap)", async () => {
      __setSandboxDepsForTests({
        platformOverride: "linux",
        which: () => false,
      });
      await expect(runInSandbox("ls", ["-la"])).rejects.toThrow(/bwrap/);
    });
  });
});
