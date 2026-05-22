import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockState } = vi.hoisted(() => ({
  mockState: {
    file: { servers: {} as Record<string, unknown> },
    configPath: "/tmp/mock-mcp-servers.json",
  },
}));

vi.mock("../utils/mcp-client/config", () => ({
  getConfigPath: () => mockState.configPath,
  loadServers: () => ({ servers: { ...mockState.file.servers } }),
  saveServers: (file: { servers: Record<string, unknown> }) => {
    mockState.file.servers = { ...file.servers };
  },
  listServers: () =>
    Object.entries(mockState.file.servers).map(([name, cfg]) => ({
      name,
      ...(cfg as object),
    })),
  getServer: (name: string) => {
    const cfg = mockState.file.servers[name];
    return cfg ? { name, ...(cfg as object) } : undefined;
  },
  addServer: (config: { name: string } & Record<string, unknown>) => {
    if (mockState.file.servers[config.name]) throw new Error("already exists");
    const { name: _n, ...rest } = config;
    mockState.file.servers[config.name] = rest;
  },
  upsertServer: (config: { name: string } & Record<string, unknown>) => {
    const { name, ...rest } = config;
    mockState.file.servers[name] = rest;
  },
  removeServer: (name: string) => {
    if (!mockState.file.servers[name]) return false;
    delete mockState.file.servers[name];
    return true;
  },
}));

vi.mock("../utils/visual-system", () => ({
  style: () => ({
    brand: (s: string) => s,
    dim: (s: string) => s,
    bold: (s: string) => s,
    success: (s: string) => s,
    error: (s: string) => s,
    warning: (s: string) => s,
  }),
}));

import {
  browseCommand,
  installCommand,
  searchCommand,
  uninstallCommand,
  __setExecFileRunnerForTests,
} from "./mcp-marketplace";
import { REGISTRY } from "../utils/mcp-registry";

let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

function readConfig(): { servers: Record<string, unknown> } {
  return { servers: { ...mockState.file.servers } };
}

function writeConfig(data: { servers: Record<string, unknown> }): void {
  mockState.file.servers = { ...data.servers };
}

beforeEach(() => {
  mockState.file.servers = {};
  process.exitCode = 0;
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  __setExecFileRunnerForTests(null);
  logSpy.mockRestore();
  errSpy.mockRestore();
  process.exitCode = 0;
});

describe("browseCommand", () => {
  it("prints each registry entry with name and description", () => {
    browseCommand();
    const out = logSpy.mock.calls.flat().join("\n");
    for (const entry of REGISTRY) {
      expect(out).toContain(entry.displayName);
      expect(out).toContain(entry.description);
    }
  });

  it("groups by category", () => {
    browseCommand();
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("Productivity");
    expect(out).toContain("Developer Tools");
    expect(out).toContain("Data");
    expect(out).toContain("Communication");
  });

  it("includes a settings.json tip", () => {
    browseCommand();
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out.toLowerCase()).toContain("settings file");
  });

  it("emits JSON when --json", () => {
    browseCommand({ json: true });
    const raw = (logSpy.mock.calls[0]?.[0] ?? "") as string;
    const parsed = JSON.parse(raw) as { entries: unknown[] };
    expect(parsed.entries).toHaveLength(REGISTRY.length);
  });
});

describe("searchCommand", () => {
  it("returns helpful message when query is empty", () => {
    searchCommand("");
    expect(process.exitCode).toBe(1);
    const err = errSpy.mock.calls.flat().join("\n");
    expect(err).toContain("Usage");
  });

  it("prints matches for a known tag", () => {
    searchCommand("database");
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("Postgres");
    expect(out).toContain("SQLite");
  });

  it("prints suggestion when no match", () => {
    searchCommand("xyzzy-nope");
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("No MCP servers matched");
  });

  it("emits JSON with results when --json", () => {
    searchCommand("github", { json: true });
    const raw = (logSpy.mock.calls[0]?.[0] ?? "") as string;
    const parsed = JSON.parse(raw) as { results: Array<{ name: string }> };
    expect(parsed.results[0]?.name).toBe("github");
  });
});

describe("installCommand", () => {
  it("rejects unknown name with suggestion when close match exists", async () => {
    await installCommand("gith");
    expect(process.exitCode).toBe(1);
    const err = errSpy.mock.calls.flat().join("\n");
    expect(err).toContain("Unknown MCP server");
    expect(err).toContain("github");
  });

  it("rejects unknown name with browse hint when no close match", async () => {
    await installCommand("totally-fake-server");
    expect(process.exitCode).toBe(1);
    const err = errSpy.mock.calls.flat().join("\n");
    expect(err).toContain("consilium mcp browse");
  });

  it("rejects when name missing", async () => {
    await installCommand(undefined);
    expect(process.exitCode).toBe(1);
    const err = errSpy.mock.calls.flat().join("\n");
    expect(err).toContain("Usage");
  });

  it("runs npm install -g and writes config for npm-based entry", async () => {
    const exec = vi.fn(async () => ({ stdout: "ok", stderr: "", code: 0 }));
    __setExecFileRunnerForTests(exec);

    await installCommand("github");

    expect(exec).toHaveBeenCalledTimes(1);
    const call = exec.mock.calls[0] as unknown as [string, string[]];
    const [cmd, args] = call;
    expect(cmd).toBe("npm");
    expect(args).toEqual([
      "install",
      "-g",
      "@modelcontextprotocol/server-github",
    ]);

    const cfg = readConfig();
    expect(cfg.servers["github"]).toBeDefined();
    const server = cfg.servers["github"] as {
      command: string;
      args: string[];
      env?: Record<string, string>;
    };
    expect(server.command).toBe("npx");
    expect(server.args).toContain("@modelcontextprotocol/server-github");
    expect(server.env?.["GITHUB_PERSONAL_ACCESS_TOKEN"]).toBeDefined();
    expect(process.exitCode).toBe(0);
  });

  it("surfaces npm failure and does not flip exit code 0", async () => {
    const exec = vi.fn(async () => ({
      stdout: "",
      stderr: "boom",
      code: 1,
    }));
    __setExecFileRunnerForTests(exec);

    await installCommand("github");

    expect(process.exitCode).toBe(1);
    const cfg = readConfig();
    expect(cfg.servers["github"]).toBeUndefined();
  });

  it("does not run npm for python-only entries; writes config", async () => {
    const exec = vi.fn(async () => ({ stdout: "", stderr: "", code: 0 }));
    __setExecFileRunnerForTests(exec);

    await installCommand("git");

    expect(exec).not.toHaveBeenCalled();
    const cfg = readConfig();
    expect(cfg.servers["git"]).toBeDefined();
    const server = cfg.servers["git"] as { command: string };
    expect(server.command).toBe("uvx");
    expect(process.exitCode).toBe(0);
  });

  it("emits JSON when --json", async () => {
    __setExecFileRunnerForTests(async () => ({
      stdout: "",
      stderr: "",
      code: 0,
    }));
    await installCommand("memory", { json: true });
    const jsonCall = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0] ?? ""))
      .find((s: string) => s.includes("installed"));
    expect(jsonCall).toBeDefined();
    const parsed = JSON.parse(jsonCall as string);
    expect(parsed.installed).toBe("memory");
  });
});

describe("uninstallCommand", () => {
  it("rejects when name missing", async () => {
    await uninstallCommand(undefined);
    expect(process.exitCode).toBe(1);
  });

  it("rejects when name is unknown and not configured", async () => {
    await uninstallCommand("nonexistent");
    expect(process.exitCode).toBe(1);
    const err = errSpy.mock.calls.flat().join("\n");
    expect(err).toContain("No MCP server");
  });

  it("removes config entry and runs npm uninstall -g", async () => {
    writeConfig({
      servers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          transport: "stdio",
        },
      },
    });

    const exec = vi.fn(async () => ({ stdout: "ok", stderr: "", code: 0 }));
    __setExecFileRunnerForTests(exec);

    await uninstallCommand("github");

    expect(exec).toHaveBeenCalledTimes(1);
    const call = exec.mock.calls[0] as unknown as [string, string[]];
    const [cmd, args] = call;
    expect(cmd).toBe("npm");
    expect(args).toEqual([
      "uninstall",
      "-g",
      "@modelcontextprotocol/server-github",
    ]);

    const cfg = readConfig();
    expect(cfg.servers["github"]).toBeUndefined();
  });

  it("skips npm uninstall when --keep-package", async () => {
    writeConfig({
      servers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          transport: "stdio",
        },
      },
    });
    const exec = vi.fn(async () => ({ stdout: "", stderr: "", code: 0 }));
    __setExecFileRunnerForTests(exec);

    await uninstallCommand("github", { keepPackage: true });

    expect(exec).not.toHaveBeenCalled();
    const cfg = readConfig();
    expect(cfg.servers["github"]).toBeUndefined();
  });

  it("emits JSON when --json", async () => {
    writeConfig({
      servers: {
        memory: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-memory"],
          transport: "stdio",
        },
      },
    });
    __setExecFileRunnerForTests(async () => ({
      stdout: "",
      stderr: "",
      code: 0,
    }));
    await uninstallCommand("memory", { json: true });
    const jsonCall = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0] ?? ""))
      .find((s: string) => s.includes("uninstalled"));
    expect(jsonCall).toBeDefined();
    const parsed = JSON.parse(jsonCall as string);
    expect(parsed.uninstalled).toBe("memory");
    expect(parsed.configRemoved).toBe(true);
  });
});
