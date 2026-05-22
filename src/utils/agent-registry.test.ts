import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentRecord,
  createAgent,
  ensureRegistryDir,
  getAgent,
  getAgentsDir,
  getLogPath,
  listAgents,
  removeAgent,
  sanitizeArgs,
  updateAgentStatus,
} from "./agent-registry";

let tmpDir: string;
let killSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "consilium-agents-"));
  process.env["CONSILIUM_AGENTS_DIR"] = tmpDir;
  killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
});

afterEach(() => {
  delete process.env["CONSILIUM_AGENTS_DIR"];
  killSpy.mockRestore();
  if (fs.existsSync(tmpDir))
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeRecord(
  overrides: Partial<AgentRecord> = {},
): Omit<AgentRecord, "startedAt"> {
  const id = overrides.id ?? "agent-1";
  return {
    id,
    command: overrides.command ?? "debate",
    args: overrides.args ?? ["hello"],
    pid: overrides.pid ?? 12345,
    status: overrides.status ?? "running",
    logPath: overrides.logPath ?? path.join(tmpDir, `${id}.log`),
    cwd: overrides.cwd ?? "/tmp",
    ...(overrides.exitCode !== undefined
      ? { exitCode: overrides.exitCode }
      : {}),
    ...(overrides.exitedAt !== undefined
      ? { exitedAt: overrides.exitedAt }
      : {}),
  };
}

describe("agent-registry paths", () => {
  it("respects CONSILIUM_AGENTS_DIR override", () => {
    expect(getAgentsDir()).toBe(tmpDir);
    expect(getLogPath("abc")).toBe(path.join(tmpDir, "abc.log"));
  });

  it("falls back to ~/.consilium/agents when env unset", () => {
    delete process.env["CONSILIUM_AGENTS_DIR"];
    expect(getAgentsDir()).toBe(
      path.join(os.homedir(), ".consilium", "agents"),
    );
  });

  it("ensureRegistryDir creates the directory", () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    expect(fs.existsSync(tmpDir)).toBe(false);
    ensureRegistryDir();
    expect(fs.existsSync(tmpDir)).toBe(true);
  });
});

describe("sanitizeArgs", () => {
  it("strips --bg and -b flags", () => {
    expect(sanitizeArgs(["topic", "--bg"])).toEqual(["topic"]);
    expect(sanitizeArgs(["topic", "-b"])).toEqual(["topic"]);
  });

  it("strips --token/--api-key and their values", () => {
    expect(
      sanitizeArgs(["topic", "--token", "secret", "--mode", "quick"]),
    ).toEqual(["topic", "--mode", "quick"]);
    expect(sanitizeArgs(["topic", "--api-key=abc", "--mode", "quick"])).toEqual(
      ["topic", "--mode", "quick"],
    );
  });

  it("preserves everything else", () => {
    const args = ["topic", "--mode", "council", "-m", "gpt-5.4"];
    expect(sanitizeArgs(args)).toEqual(args);
  });
});

describe("createAgent / getAgent / listAgents", () => {
  it("round-trips a record to disk and back", () => {
    const created = createAgent(makeRecord());
    expect(created.startedAt).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(tmpDir, "agent-1.json"))).toBe(true);
    const fetched = getAgent("agent-1");
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe("agent-1");
    expect(fetched?.command).toBe("debate");
    expect(fetched?.args).toEqual(["hello"]);
  });

  it("listAgents returns all known records sorted newest first", () => {
    const a = createAgent(makeRecord({ id: "a" }));
    const b = createAgent(
      makeRecord({ id: "b", logPath: path.join(tmpDir, "b.log") }),
    );
    const list = listAgents();
    expect(list).toHaveLength(2);
    expect(list[0]?.startedAt).toBeGreaterThanOrEqual(list[1]?.startedAt ?? 0);
    const ids = list.map((r) => r.id).sort();
    expect(ids).toEqual([a.id, b.id].sort());
  });

  it("returns null for missing agents", () => {
    expect(getAgent("nope")).toBeNull();
  });

  it("ignores non-JSON files in the registry dir", () => {
    createAgent(makeRecord());
    fs.writeFileSync(path.join(tmpDir, "garbage.txt"), "ignore me");
    fs.writeFileSync(path.join(tmpDir, "bad.json"), "not json");
    const list = listAgents();
    expect(list).toHaveLength(1);
  });
});

describe("updateAgentStatus / removeAgent", () => {
  it("merges patch into existing record", () => {
    createAgent(makeRecord({ id: "u1" }));
    updateAgentStatus("u1", { status: "exited", exitCode: 0, exitedAt: 42 });
    const fetched = getAgent("u1");
    expect(fetched?.status).toBe("exited");
    expect(fetched?.exitCode).toBe(0);
    expect(fetched?.exitedAt).toBe(42);
  });

  it("does nothing when updating a missing record", () => {
    updateAgentStatus("missing", { status: "exited" });
    expect(getAgent("missing")).toBeNull();
  });

  it("removeAgent deletes the json file and the log if present", () => {
    const rec = createAgent(makeRecord({ id: "rm1" }));
    fs.writeFileSync(rec.logPath, "log data");
    expect(fs.existsSync(path.join(tmpDir, "rm1.json"))).toBe(true);
    removeAgent("rm1");
    expect(fs.existsSync(path.join(tmpDir, "rm1.json"))).toBe(false);
    expect(fs.existsSync(rec.logPath)).toBe(false);
  });
});

describe("stale process detection", () => {
  it("marks records exited when process.kill throws ESRCH", () => {
    createAgent(makeRecord({ id: "stale", status: "running" }));
    killSpy.mockImplementation(() => {
      const err = new Error("kill ESRCH") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    });
    const fetched = getAgent("stale");
    expect(fetched?.status).toBe("exited");
    expect(fetched?.exitedAt).toBeGreaterThan(0);
  });

  it("leaves running records intact when process.kill succeeds", () => {
    createAgent(makeRecord({ id: "alive", status: "running" }));
    killSpy.mockImplementation(() => true);
    const fetched = getAgent("alive");
    expect(fetched?.status).toBe("running");
  });

  it("treats EPERM as alive (cross-user pid)", () => {
    createAgent(makeRecord({ id: "perm", status: "running" }));
    killSpy.mockImplementation(() => {
      const err = new Error("kill EPERM") as NodeJS.ErrnoException;
      err.code = "EPERM";
      throw err;
    });
    const fetched = getAgent("perm");
    expect(fetched?.status).toBe("running");
  });

  it("does not re-check status for already-exited records", () => {
    createAgent(
      makeRecord({ id: "done", status: "exited", exitedAt: 100, exitCode: 0 }),
    );
    killSpy.mockClear();
    killSpy.mockImplementation(() => {
      throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
    });
    const fetched = getAgent("done");
    expect(fetched?.status).toBe("exited");
    expect(killSpy).not.toHaveBeenCalled();
  });
});
