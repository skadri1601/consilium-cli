import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSpawnDetached,
  mockStopAgent,
  mockRespawnAgent,
  mockAttachToAgent,
  mockReadLogOnce,
  mockTailLogFile,
} = vi.hoisted(() => ({
  mockSpawnDetached: vi.fn(),
  mockStopAgent: vi.fn(),
  mockRespawnAgent: vi.fn(),
  mockAttachToAgent: vi.fn(),
  mockReadLogOnce: vi.fn(),
  mockTailLogFile: vi.fn(),
}));

vi.mock("../utils/agent-supervisor", () => ({
  spawnDetached: mockSpawnDetached,
  stopAgent: mockStopAgent,
  respawnAgent: mockRespawnAgent,
  attachToAgent: mockAttachToAgent,
  readLogOnce: mockReadLogOnce,
  tailLogFile: mockTailLogFile,
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
  agentsAttachCommand,
  agentsListCommand,
  agentsLogsCommand,
  agentsRemoveCommand,
  agentsRespawnCommand,
  agentsStopCommand,
} from "./agents";
import { createAgent, getAgent } from "../utils/agent-registry";

let tmpDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
let killSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "consilium-agents-cmd-"));
  process.env["CONSILIUM_AGENTS_DIR"] = tmpDir;
  process.exitCode = 0;
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
  mockSpawnDetached.mockReset();
  mockStopAgent.mockReset();
  mockRespawnAgent.mockReset();
  mockAttachToAgent.mockReset();
  mockReadLogOnce.mockReset();
  mockTailLogFile.mockReset();
});

afterEach(() => {
  delete process.env["CONSILIUM_AGENTS_DIR"];
  process.exitCode = 0;
  logSpy.mockRestore();
  errSpy.mockRestore();
  killSpy.mockRestore();
  if (fs.existsSync(tmpDir))
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function seedAgent(overrides: Partial<Parameters<typeof createAgent>[0]> = {}) {
  return createAgent({
    id: overrides.id ?? "ag-1",
    command: overrides.command ?? "debate",
    args: overrides.args ?? ["hello", "--mode", "quick"],
    pid: overrides.pid ?? 1234,
    status: overrides.status ?? "running",
    logPath:
      overrides.logPath ?? path.join(tmpDir, `${overrides.id ?? "ag-1"}.log`),
    cwd: overrides.cwd ?? "/tmp",
    ...(overrides.exitCode !== undefined
      ? { exitCode: overrides.exitCode }
      : {}),
    ...(overrides.exitedAt !== undefined
      ? { exitedAt: overrides.exitedAt }
      : {}),
  });
}

describe("agentsListCommand", () => {
  it("prints empty-state hint when no agents exist", async () => {
    await agentsListCommand();
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("No background agents recorded");
    expect(out).toContain("--bg");
  });

  it("emits JSON when --json is set", async () => {
    seedAgent();
    await agentsListCommand({ json: true });
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain('"id": "ag-1"');
    expect(out).toContain('"command": "debate"');
  });

  it("prints a human-readable table by default", async () => {
    seedAgent();
    await agentsListCommand();
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("ag-1");
    expect(out).toContain("debate");
    expect(out).toContain("pid=1234");
  });
});

describe("agentsAttachCommand", () => {
  it("returns an error when the agent is missing", async () => {
    await agentsAttachCommand("missing");
    expect(process.exitCode).toBe(1);
    const err = errSpy.mock.calls.flat().join("\n");
    expect(err).toContain("Agent not found");
  });

  it("calls attachToAgent for an existing agent", async () => {
    seedAgent();
    mockAttachToAgent.mockResolvedValue(undefined);
    await agentsAttachCommand("ag-1");
    expect(mockAttachToAgent).toHaveBeenCalledWith("ag-1");
  });
});

describe("agentsStopCommand", () => {
  it("calls supervisor.stopAgent and prints success", async () => {
    seedAgent();
    mockStopAgent.mockResolvedValue(undefined);
    await agentsStopCommand("ag-1");
    expect(mockStopAgent).toHaveBeenCalledWith("ag-1");
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("Stopped agent ag-1");
  });

  it("no-ops for already-stopped agents", async () => {
    seedAgent({
      status: "exited",
      exitCode: 0,
      exitedAt: Date.now(),
    });
    await agentsStopCommand("ag-1");
    expect(mockStopAgent).not.toHaveBeenCalled();
  });

  it("exits 1 when supervisor throws", async () => {
    seedAgent();
    mockStopAgent.mockRejectedValue(new Error("boom"));
    await agentsStopCommand("ag-1");
    expect(process.exitCode).toBe(1);
  });

  it("errors on missing agent", async () => {
    await agentsStopCommand("missing");
    expect(process.exitCode).toBe(1);
    expect(mockStopAgent).not.toHaveBeenCalled();
  });
});

describe("agentsLogsCommand", () => {
  it("prints the log once when --follow is not set", async () => {
    const rec = seedAgent();
    fs.writeFileSync(rec.logPath, "hello world\n");
    mockReadLogOnce.mockResolvedValue(undefined);
    await agentsLogsCommand("ag-1");
    expect(mockReadLogOnce).toHaveBeenCalledWith("ag-1");
    expect(mockTailLogFile).not.toHaveBeenCalled();
  });

  it("tails the log when --follow is set", async () => {
    const rec = seedAgent();
    fs.writeFileSync(rec.logPath, "hello\n");
    mockTailLogFile.mockResolvedValue(undefined);
    await agentsLogsCommand("ag-1", { follow: true });
    expect(mockTailLogFile).toHaveBeenCalled();
    expect(mockReadLogOnce).not.toHaveBeenCalled();
  });

  it("errors on missing agent", async () => {
    await agentsLogsCommand("missing");
    expect(process.exitCode).toBe(1);
  });
});

describe("agentsRespawnCommand", () => {
  it("respawns and prints the new id", async () => {
    seedAgent();
    mockRespawnAgent.mockResolvedValue({
      id: "ag-2",
      pid: 9999,
      args: ["hello"],
      command: "debate",
      cwd: "/tmp",
      logPath: path.join(tmpDir, "ag-2.log"),
      startedAt: Date.now(),
      status: "running",
    });
    await agentsRespawnCommand("ag-1");
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("Respawned ag-1 as ag-2");
  });

  it("exits 1 on respawn failure", async () => {
    seedAgent();
    mockRespawnAgent.mockRejectedValue(new Error("nope"));
    await agentsRespawnCommand("ag-1");
    expect(process.exitCode).toBe(1);
  });

  it("errors on missing agent", async () => {
    await agentsRespawnCommand("missing");
    expect(process.exitCode).toBe(1);
    expect(mockRespawnAgent).not.toHaveBeenCalled();
  });
});

describe("agentsRemoveCommand", () => {
  it("refuses to remove running agents", async () => {
    seedAgent();
    await agentsRemoveCommand("ag-1");
    expect(process.exitCode).toBe(1);
    expect(getAgent("ag-1")).not.toBeNull();
  });

  it("removes exited agents from the registry", async () => {
    seedAgent({ status: "exited", exitedAt: Date.now(), exitCode: 0 });
    await agentsRemoveCommand("ag-1");
    expect(getAgent("ag-1")).toBeNull();
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("Removed agent ag-1");
  });

  it("errors on missing agent", async () => {
    await agentsRemoveCommand("missing");
    expect(process.exitCode).toBe(1);
  });
});
