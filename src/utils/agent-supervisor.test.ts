import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return { ...actual, spawn: mockSpawn };
});

import {
  attachToAgent,
  respawnAgent,
  spawnDetached,
  stopAgent,
  tailLogFile,
} from "./agent-supervisor";
import { createAgent, getAgent, getLogPath } from "./agent-registry";

let tmpDir: string;
let killSpy: ReturnType<typeof vi.spyOn>;

function makeChild(pid: number) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    unref: () => void;
  };
  child.pid = pid;
  child.unref = vi.fn();
  return child;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "consilium-sup-"));
  process.env["CONSILIUM_AGENTS_DIR"] = tmpDir;
  mockSpawn.mockReset();
  killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
});

afterEach(() => {
  delete process.env["CONSILIUM_AGENTS_DIR"];
  killSpy.mockRestore();
  if (fs.existsSync(tmpDir))
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("spawnDetached", () => {
  it("creates a registry record, a log file, and unrefs the child", async () => {
    const child = makeChild(54321);
    mockSpawn.mockReturnValue(child);

    const rec = await spawnDetached({
      command: "debate",
      args: ["hello world", "--bg", "--mode", "quick"],
      cwd: "/tmp",
    });

    expect(rec.pid).toBe(54321);
    expect(rec.status).toBe("running");
    expect(rec.command).toBe("debate");
    expect(rec.args).toEqual(["hello world", "--mode", "quick"]);
    expect(rec.cwd).toBe("/tmp");
    expect(fs.existsSync(path.join(tmpDir, `${rec.id}.json`))).toBe(true);
    expect(fs.existsSync(rec.logPath)).toBe(true);
    expect(child.unref).toHaveBeenCalled();
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const callArgs = mockSpawn.mock.calls[0]![1] as string[];
    expect(callArgs).toContain("debate");
    expect(callArgs).toContain("hello world");
    expect(callArgs).not.toContain("--bg");
    const spawnOpts = mockSpawn.mock.calls[0]![2] as {
      detached?: boolean;
      stdio?: unknown;
      env?: NodeJS.ProcessEnv;
    };
    expect(spawnOpts.detached).toBe(true);
    expect(spawnOpts.env?.["CONSILIUM_BG_AGENT"]).toBe("1");
  });

  it("throws when spawn returns no pid", async () => {
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = vi.fn();
    mockSpawn.mockReturnValue(child);
    await expect(
      spawnDetached({ command: "debate", args: ["x"] }),
    ).rejects.toThrow(/no pid/);
  });
});

describe("stopAgent", () => {
  it("sends SIGTERM and updates status to killed", async () => {
    const rec = createAgent({
      id: "stop-1",
      command: "debate",
      args: ["x"],
      pid: 9999,
      status: "running",
      logPath: getLogPath("stop-1"),
      cwd: "/tmp",
    });
    let aliveCalls = 0;
    killSpy.mockImplementation(
      (_pid: number, signal?: number | NodeJS.Signals) => {
        if (signal === "SIGTERM") return true;
        if (signal === 0) {
          aliveCalls += 1;
          if (aliveCalls > 1) {
            const err = new Error("ESRCH") as NodeJS.ErrnoException;
            err.code = "ESRCH";
            throw err;
          }
          return true;
        }
        return true;
      },
    );

    await stopAgent(rec.id, { timeoutMs: 500 });

    const stopCalls = (killSpy.mock.calls as unknown[][]).filter(
      (c) => c[1] === "SIGTERM",
    );
    expect(stopCalls.length).toBeGreaterThanOrEqual(1);
    const fetched = getAgent(rec.id);
    expect(fetched?.status).toBe("killed");
    expect(fetched?.exitedAt).toBeGreaterThan(0);
  });

  it("marks already-dead process as exited and skips SIGTERM", async () => {
    const rec = createAgent({
      id: "stop-2",
      command: "debate",
      args: ["x"],
      pid: 7777,
      status: "running",
      logPath: getLogPath("stop-2"),
      cwd: "/tmp",
    });
    killSpy.mockImplementation(
      (_pid: number, signal?: number | NodeJS.Signals) => {
        if (signal === "SIGTERM") {
          const err = new Error("ESRCH") as NodeJS.ErrnoException;
          err.code = "ESRCH";
          throw err;
        }
        return true;
      },
    );
    await stopAgent(rec.id);
    const fetched = getAgent(rec.id);
    expect(fetched?.status).toBe("exited");
  });

  it("escalates to SIGKILL after timeout", async () => {
    const rec = createAgent({
      id: "stop-3",
      command: "debate",
      args: ["x"],
      pid: 5555,
      status: "running",
      logPath: getLogPath("stop-3"),
      cwd: "/tmp",
    });
    killSpy.mockImplementation(() => true);
    await stopAgent(rec.id, { timeoutMs: 50 });
    const signals = (killSpy.mock.calls as unknown[][]).map((c) => c[1]);
    expect(signals).toContain("SIGKILL");
  });

  it("throws when agent does not exist", async () => {
    await expect(stopAgent("nope")).rejects.toThrow(/not found/);
  });
});

describe("respawnAgent", () => {
  it("re-spawns with the same args and produces a new id", async () => {
    const initial = createAgent({
      id: "rs-1",
      command: "debate",
      args: ["topic", "--mode", "quick"],
      pid: 4444,
      status: "exited",
      logPath: getLogPath("rs-1"),
      cwd: "/tmp",
      exitedAt: Date.now(),
      exitCode: 0,
    });
    const child = makeChild(5151);
    mockSpawn.mockReturnValue(child);
    const next = await respawnAgent(initial.id);
    expect(next.id).not.toBe(initial.id);
    expect(next.args).toEqual(["topic", "--mode", "quick"]);
    expect(next.pid).toBe(5151);
    expect(next.command).toBe("debate");
  });

  it("throws when agent missing", async () => {
    await expect(respawnAgent("missing")).rejects.toThrow(/not found/);
  });
});

describe("tailLogFile / attachToAgent", () => {
  it("streams log content and exits when isDone returns true", async () => {
    const file = path.join(tmpDir, "tail.log");
    fs.writeFileSync(file, "hello\n");
    const writes: string[] = [];
    const sink = {
      write: (chunk: string | Buffer) => {
        writes.push(
          typeof chunk === "string" ? chunk : chunk.toString("utf-8"),
        );
        return true;
      },
    } as unknown as NodeJS.WritableStream;
    let done = false;
    setTimeout(() => {
      fs.appendFileSync(file, "world\n");
      setTimeout(() => {
        done = true;
      }, 80);
    }, 30);
    await tailLogFile(file, () => done, sink, 20);
    const joined = writes.join("");
    expect(joined).toContain("hello");
    expect(joined).toContain("world");
  });

  it("attachToAgent tails until the pid is gone", async () => {
    const rec = createAgent({
      id: "att-1",
      command: "debate",
      args: ["x"],
      pid: 8888,
      status: "running",
      logPath: getLogPath("att-1"),
      cwd: "/tmp",
    });
    fs.writeFileSync(rec.logPath, "line-1\n");
    killSpy.mockImplementation(() => {
      const err = new Error("ESRCH") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    });
    const writes: string[] = [];
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        writes.push(
          typeof chunk === "string"
            ? chunk
            : Buffer.from(chunk).toString("utf-8"),
        );
        return true;
      });
    try {
      await attachToAgent(rec.id);
    } finally {
      stdoutSpy.mockRestore();
    }
    expect(writes.join("")).toContain("line-1");
  });
});
