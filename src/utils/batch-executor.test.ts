import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSpawn, mockCreateWorktree, mockExecFile } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockCreateWorktree: vi.fn(),
  mockExecFile: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    spawn: mockSpawn,
    execFile: (
      cmd: string,
      args: string[],
      cb: (err: unknown, out: { stdout: string; stderr: string }) => void,
    ) => mockExecFile(cmd, args, cb),
  };
});

vi.mock("./worktree.js", () => ({
  createWorktree: mockCreateWorktree,
}));

import { runBatch } from "./batch-executor";

interface FakeChildOpts {
  stdoutChunks?: string[];
  stderrChunks?: string[];
  exitCode?: number;
  errorAfter?: number;
  closeAfter?: number;
  hangs?: boolean;
}

function makeChild(opts: FakeChildOpts = {}) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter | null;
    stderr: EventEmitter | null;
    pid?: number;
    kill?: () => void;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 9999;
  child.kill = vi.fn();

  if (opts.hangs) {
    return child;
  }

  setTimeout(() => {
    for (const chunk of opts.stdoutChunks ?? []) {
      child.stdout!.emit("data", Buffer.from(chunk, "utf-8"));
    }
    for (const chunk of opts.stderrChunks ?? []) {
      child.stderr!.emit("data", Buffer.from(chunk, "utf-8"));
    }
    if (opts.errorAfter !== undefined) {
      setTimeout(
        () => child.emit("error", new Error("spawn fail")),
        opts.errorAfter,
      );
    } else {
      setTimeout(
        () => child.emit("close", opts.exitCode ?? 0),
        opts.closeAfter ?? 5,
      );
    }
  }, 1);

  return child;
}

let worktreeCounter = 0;

beforeEach(() => {
  mockSpawn.mockReset();
  mockCreateWorktree.mockReset();
  mockExecFile.mockReset();
  worktreeCounter = 0;
  mockCreateWorktree.mockImplementation(async (branch?: string) => {
    const id = worktreeCounter++;
    return {
      path: `/tmp/wt-${id}`,
      branch: branch ?? `consilium-batch-${id}`,
    };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runBatch validation", () => {
  it("rejects count below 1", async () => {
    await expect(runBatch({ count: 0, topic: "x" })).rejects.toThrow(
      /1 and 30/,
    );
  });

  it("rejects count above 30", async () => {
    await expect(runBatch({ count: 31, topic: "x" })).rejects.toThrow(
      /1 and 30/,
    );
  });

  it("rejects non-integer count", async () => {
    await expect(runBatch({ count: 2.5, topic: "x" })).rejects.toThrow(
      /1 and 30/,
    );
  });

  it("rejects empty topic", async () => {
    await expect(runBatch({ count: 1, topic: "   " })).rejects.toThrow(
      /topic is required/,
    );
  });
});

describe("runBatch success path", () => {
  it("creates worktrees and runs spawns concurrently", async () => {
    const concurrent: number[] = [];
    let active = 0;
    mockSpawn.mockImplementation(() => {
      active++;
      concurrent.push(active);
      const child = makeChild({
        stdoutChunks: [JSON.stringify({ synthesis: "ok synth from agent" })],
        exitCode: 0,
        closeAfter: 30,
      });
      child.on("close", () => {
        active--;
      });
      return child;
    });

    const results = await runBatch({
      count: 3,
      topic: "Refactor module X",
      mode: "council",
    });

    expect(results).toHaveLength(3);
    expect(mockCreateWorktree).toHaveBeenCalledTimes(3);
    expect(mockSpawn).toHaveBeenCalledTimes(3);
    for (const r of results) {
      expect(r.status).toBe("success");
      expect(r.synthesis).toContain("ok synth");
      expect(r.task.worktreePath).toMatch(/^\/tmp\/wt-\d+$/);
    }
    expect(Math.max(...concurrent)).toBeGreaterThanOrEqual(2);
  });

  it("passes mode and json output flags to the spawn args", async () => {
    mockSpawn.mockImplementation(() =>
      makeChild({
        stdoutChunks: ["raw text body"],
        exitCode: 0,
        closeAfter: 5,
      }),
    );

    await runBatch({
      count: 1,
      topic: "investigate bug",
      mode: "quick",
      models: ["claude-opus-4-7", "gpt-5.5"],
    });

    const callArgs = mockSpawn.mock.calls[0]![1] as string[];
    expect(callArgs).toContain("debate");
    expect(callArgs).toContain("investigate bug");
    expect(callArgs).toContain("--mode");
    expect(callArgs).toContain("quick");
    expect(callArgs).toContain("--output-format");
    expect(callArgs).toContain("json");
    expect(callArgs).toContain("--max-budget-usd");
    expect(callArgs).toContain("--models");
    expect(callArgs).toContain("claude-opus-4-7,gpt-5.5");
  });
});

describe("runBatch failure paths", () => {
  it("captures non-zero exit as failed", async () => {
    mockSpawn.mockImplementation(() =>
      makeChild({
        stderrChunks: ["something blew up"],
        exitCode: 2,
        closeAfter: 5,
      }),
    );

    const results = await runBatch({ count: 2, topic: "topic" });
    for (const r of results) {
      expect(r.status).toBe("failed");
      expect(r.error).toContain("something blew up");
    }
  });

  it("reports timeout when the child hangs past timeoutMs", async () => {
    mockSpawn.mockImplementation(() => makeChild({ hangs: true }));
    const results = await runBatch({
      count: 1,
      topic: "slow topic",
      timeoutMs: 25,
    });
    expect(results[0]!.status).toBe("timeout");
    expect(results[0]!.error).toMatch(/Timed out/);
  });

  it("captures spawn error event as failed", async () => {
    mockSpawn.mockImplementation(() => makeChild({ errorAfter: 5 }));
    const results = await runBatch({ count: 1, topic: "topic" });
    expect(results[0]!.status).toBe("failed");
    expect(results[0]!.error).toContain("spawn fail");
  });
});

describe("runBatch openPRs", () => {
  it("skips PR creation when gh is missing", async () => {
    mockSpawn.mockImplementation(() =>
      makeChild({
        stdoutChunks: [JSON.stringify({ synthesis: "done" })],
        exitCode: 0,
        closeAfter: 5,
      }),
    );
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], cb: (err: unknown) => void) => {
        cb(new Error("not found"));
      },
    );

    const results = await runBatch({
      count: 1,
      topic: "needs pr",
      openPRs: true,
    });
    expect(results[0]!.status).toBe("success");
    expect(results[0]!.prUrl).toBeUndefined();
  });
});
