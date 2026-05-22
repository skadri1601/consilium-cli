import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  detectPlatform,
  detectSandboxCapabilities,
  runInSandboxNative,
  buildSeatbeltProfile,
  buildBwrapArgs,
  __setSandboxDepsForTests,
  __resetSandboxDepsForTests,
} from "./sandbox-native";

afterEach(() => {
  __resetSandboxDepsForTests();
});

describe("detectPlatform", () => {
  it("returns one of the four allowed values", () => {
    const p = detectPlatform();
    expect(["darwin", "linux", "win32", "unsupported"]).toContain(p);
  });

  it("maps darwin process.platform to darwin", () => {
    __setSandboxDepsForTests({ platformOverride: "darwin" });
    expect(detectPlatform()).toBe("darwin");
  });

  it("maps linux process.platform to linux", () => {
    __setSandboxDepsForTests({ platformOverride: "linux" });
    expect(detectPlatform()).toBe("linux");
  });

  it("maps win32 process.platform to win32", () => {
    __setSandboxDepsForTests({ platformOverride: "win32" });
    expect(detectPlatform()).toBe("win32");
  });

  it("maps an exotic platform to unsupported", () => {
    __setSandboxDepsForTests({
      platformOverride: "freebsd" as NodeJS.Platform,
    });
    expect(detectPlatform()).toBe("unsupported");
  });
});

describe("detectSandboxCapabilities", () => {
  it("returns the required shape", () => {
    const caps = detectSandboxCapabilities();
    expect(caps).toHaveProperty("available");
    expect(caps).toHaveProperty("platform");
    expect(caps).toHaveProperty("mechanism");
    expect(typeof caps.available).toBe("boolean");
  });

  it("on macOS with sandbox-exec present, mechanism is seatbelt", () => {
    __setSandboxDepsForTests({
      platformOverride: "darwin",
      which: (cmd) => cmd === "sandbox-exec",
    });
    const caps = detectSandboxCapabilities();
    expect(caps.available).toBe(true);
    expect(caps.platform).toBe("darwin");
    expect(caps.mechanism).toBe("seatbelt");
  });

  it("on macOS without sandbox-exec, available=false with reason", () => {
    __setSandboxDepsForTests({
      platformOverride: "darwin",
      which: () => false,
    });
    const caps = detectSandboxCapabilities();
    expect(caps.available).toBe(false);
    expect(caps.platform).toBe("darwin");
    expect(caps.reason).toMatch(/sandbox-exec/);
  });

  it("on Linux with bwrap present, mechanism is bwrap", () => {
    __setSandboxDepsForTests({
      platformOverride: "linux",
      which: (cmd) => cmd === "bwrap",
    });
    const caps = detectSandboxCapabilities();
    expect(caps.available).toBe(true);
    expect(caps.platform).toBe("linux");
    expect(caps.mechanism).toBe("bwrap");
  });

  it("on Linux without bwrap, available=false with reason", () => {
    __setSandboxDepsForTests({
      platformOverride: "linux",
      which: () => false,
    });
    const caps = detectSandboxCapabilities();
    expect(caps.available).toBe(false);
    expect(caps.reason).toMatch(/bwrap/);
  });

  it("on Windows returns worktree-fallback regardless of which", () => {
    __setSandboxDepsForTests({
      platformOverride: "win32",
      which: () => true,
    });
    const caps = detectSandboxCapabilities();
    expect(caps.available).toBe(false);
    expect(caps.platform).toBe("win32");
    expect(caps.mechanism).toBe("worktree-fallback");
  });

  it("on unsupported platform returns mechanism none", () => {
    __setSandboxDepsForTests({
      platformOverride: "aix" as NodeJS.Platform,
      which: () => true,
    });
    const caps = detectSandboxCapabilities();
    expect(caps.available).toBe(false);
    expect(caps.mechanism).toBe("none");
  });
});

describe("buildSeatbeltProfile", () => {
  it("substitutes read/write/network placeholders", () => {
    __setSandboxDepsForTests({
      loadTemplate: () =>
        "(version 1)\n{{ALLOW_READ}}\n{{ALLOW_WRITE}}\n{{ALLOW_NETWORK}}\n",
    });
    const profile = buildSeatbeltProfile({
      allowReadPaths: ["/Users/me/proj"],
      allowWritePaths: ["/Users/me/proj/out"],
      allowNetwork: false,
      cwd: "/Users/me/proj",
    });
    expect(profile).toContain('(allow file-read* (subpath "/Users/me/proj"))');
    expect(profile).toContain(
      '(allow file-write* (subpath "/Users/me/proj/out"))',
    );
    expect(profile).toContain("(deny network*)");
    expect(profile).not.toContain("{{ALLOW_READ}}");
  });

  it("emits (allow network*) when allowNetwork is true", () => {
    __setSandboxDepsForTests({
      loadTemplate: () => "{{ALLOW_READ}}\n{{ALLOW_WRITE}}\n{{ALLOW_NETWORK}}",
    });
    const profile = buildSeatbeltProfile({
      allowReadPaths: ["/x"],
      allowWritePaths: [],
      allowNetwork: true,
      cwd: "/x",
    });
    expect(profile).toContain("(allow network*)");
    expect(profile).not.toContain("(deny network*)");
  });

  it("defaults read/write to cwd when not provided", () => {
    __setSandboxDepsForTests({
      loadTemplate: () => "{{ALLOW_READ}}\n{{ALLOW_WRITE}}\n{{ALLOW_NETWORK}}",
    });
    const profile = buildSeatbeltProfile({ cwd: "/tmp/work" });
    expect(profile).toContain('(allow file-read* (subpath "/tmp/work"))');
    expect(profile).toContain('(allow file-write* (subpath "/tmp/work"))');
  });
});

describe("buildBwrapArgs", () => {
  it("builds the canonical isolation flags", () => {
    const args = buildBwrapArgs("ls", ["-la"], {
      allowNetwork: false,
      cwd: "/home/me/proj",
    });
    expect(args).toContain("--ro-bind");
    expect(args).toContain("--bind");
    expect(args).toContain("--unshare-all");
    expect(args).toContain("--tmpfs");
    expect(args).toContain("--proc");
    expect(args).toContain("--dev");
    expect(args).not.toContain("--share-net");
    expect(args[args.length - 2]).toBe("ls");
    expect(args[args.length - 1]).toBe("-la");
  });

  it("adds --share-net when allowNetwork is true", () => {
    const args = buildBwrapArgs("echo", ["hi"], {
      allowNetwork: true,
      cwd: "/x",
    });
    expect(args).toContain("--share-net");
  });
});

describe("runInSandboxNative", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invokes sandbox-exec with -p <profile> and the original command on macOS", async () => {
    const calls: Array<[string, string[], unknown]> = [];
    const execFileMock = async (
      bin: string,
      args: readonly string[],
      options: unknown,
    ) => {
      calls.push([bin, [...args], options]);
      return { stdout: "ok", stderr: "" };
    };
    __setSandboxDepsForTests({
      platformOverride: "darwin",
      which: (cmd) => cmd === "sandbox-exec",
      execFile: execFileMock,
      loadTemplate: () => "{{ALLOW_READ}}\n{{ALLOW_WRITE}}\n{{ALLOW_NETWORK}}",
    });
    const result = await runInSandboxNative("echo", ["hello"], {
      cwd: "/tmp/proj",
      allowReadPaths: ["/tmp/proj"],
      allowWritePaths: ["/tmp/proj"],
      allowNetwork: false,
    });
    expect(calls.length).toBe(1);
    const [bin, sbArgs] = calls[0]!;
    expect(bin).toBe("sandbox-exec");
    expect(sbArgs[0]).toBe("-p");
    expect(typeof sbArgs[1]).toBe("string");
    expect(sbArgs[1]).toContain("file-read*");
    expect(sbArgs[2]).toBe("echo");
    expect(sbArgs[3]).toBe("hello");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("ok");
  });

  it("invokes bwrap with isolation args and the command on Linux", async () => {
    const calls: Array<[string, string[], unknown]> = [];
    const execFileMock = async (
      bin: string,
      args: readonly string[],
      options: unknown,
    ) => {
      calls.push([bin, [...args], options]);
      return { stdout: "linux-ok", stderr: "" };
    };
    __setSandboxDepsForTests({
      platformOverride: "linux",
      which: (cmd) => cmd === "bwrap",
      execFile: execFileMock,
    });
    const result = await runInSandboxNative("ls", ["-la"], {
      cwd: "/home/me/proj",
      allowNetwork: false,
    });
    expect(calls.length).toBe(1);
    const [bin, bwrapArgs] = calls[0]!;
    expect(bin).toBe("bwrap");
    expect(bwrapArgs).toContain("--unshare-all");
    expect(bwrapArgs).toContain("--ro-bind");
    expect(bwrapArgs).toContain("ls");
    expect(bwrapArgs).toContain("-la");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("linux-ok");
  });

  it("throws when sandbox is unavailable", async () => {
    __setSandboxDepsForTests({
      platformOverride: "win32",
      which: () => false,
    });
    await expect(runInSandboxNative("echo", ["x"], {})).rejects.toThrow(
      /Sandbox unavailable/,
    );
  });

  it("rejects empty cmd", async () => {
    __setSandboxDepsForTests({
      platformOverride: "linux",
      which: () => true,
    });
    await expect(runInSandboxNative("", [], {})).rejects.toThrow(/non-empty/);
  });

  it("translates a non-zero subprocess exit into a result with code", async () => {
    const failingExec = async () => {
      const err = new Error("boom") as Error & {
        code?: number;
        stdout?: string;
        stderr?: string;
      };
      err.code = 2;
      err.stdout = "partial";
      err.stderr = "failed";
      throw err;
    };
    __setSandboxDepsForTests({
      platformOverride: "linux",
      which: (cmd) => cmd === "bwrap",
      execFile: failingExec,
    });
    const result = await runInSandboxNative("false", [], { cwd: "/tmp" });
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("partial");
    expect(result.stderr).toBe("failed");
  });
});
