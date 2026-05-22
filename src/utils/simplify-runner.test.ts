import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return { ...actual, spawn: mockSpawn };
});

import { runSimplify } from "./simplify-runner";

interface FakeChildOpts {
  stdout?: string;
  exitCode?: number;
  hangs?: boolean;
}

function makeChild(opts: FakeChildOpts = {}) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter | null;
    stderr: EventEmitter | null;
    pid?: number;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 1234;

  if (opts.hangs) return child;

  setTimeout(() => {
    if (opts.stdout) {
      child.stdout!.emit("data", Buffer.from(opts.stdout, "utf-8"));
    }
    setTimeout(() => child.emit("close", opts.exitCode ?? 0), 5);
  }, 1);

  return child;
}

beforeEach(() => {
  mockSpawn.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runSimplify", () => {
  it("returns empty result for empty input without spawning", async () => {
    const result = await runSimplify({ recentEdits: "" });
    expect(result.findings).toEqual([]);
    expect(result.consensusFixes).toEqual([]);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("spawns one process per reviewer in parallel", async () => {
    const seen: number[] = [];
    let active = 0;
    mockSpawn.mockImplementation(() => {
      active++;
      seen.push(active);
      const child = makeChild({
        stdout: "[NIT] file.ts:1 - rename variable foo",
        exitCode: 0,
      });
      child.on("close", () => {
        active--;
      });
      return child;
    });

    const result = await runSimplify({
      recentEdits: "diff --git a/file.ts b/file.ts\n+const x = 1;",
    });
    expect(mockSpawn).toHaveBeenCalledTimes(3);
    expect(result.findings.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...seen)).toBeGreaterThanOrEqual(2);
  });

  it("parses bracketed severity findings", async () => {
    mockSpawn.mockImplementation(() =>
      makeChild({
        stdout: [
          "[CRITICAL] src/a.ts:42 - null pointer dereference on user.id",
          "- [major] src/b.ts:10 - unbounded loop on input",
          "  [minor] src/c.ts - inconsistent naming style",
          "[NIT] trailing whitespace",
          "ignored line without bracket",
        ].join("\n"),
        exitCode: 0,
      }),
    );

    const result = await runSimplify({
      recentEdits: "some diff",
      reviewerCount: 1,
    });
    expect(result.findings.length).toBe(4);
    const sev = result.findings.map((f) => f.severity);
    expect(sev).toContain("critical");
    expect(sev).toContain("major");
    expect(sev).toContain("minor");
    expect(sev).toContain("nit");
    const critical = result.findings.find((f) => f.severity === "critical")!;
    expect(critical.file).toBe("src/a.ts");
    expect(critical.line).toBe(42);
    expect(critical.message).toMatch(/null pointer/);
  });

  it("extracts findings from JSON-wrapped output", async () => {
    mockSpawn.mockImplementation(() =>
      makeChild({
        stdout: JSON.stringify({
          synthesis:
            "[CRITICAL] api/route.ts:7 - missing input validation on body",
        }),
        exitCode: 0,
      }),
    );
    const result = await runSimplify({
      recentEdits: "diff",
      reviewerCount: 1,
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.severity).toBe("critical");
    expect(result.findings[0]!.file).toBe("api/route.ts");
    expect(result.findings[0]!.line).toBe(7);
  });

  it("computes consensus for findings cited by at least 2 reviewers", async () => {
    const outputs = [
      "[CRITICAL] src/a.ts:1 - unused export shouldRemove",
      "[CRITICAL] src/a.ts:1 - unused export shouldRemove",
      "[MAJOR] src/b.ts:1 - solo reviewer issue",
    ];
    let call = 0;
    mockSpawn.mockImplementation(() => {
      const stdout = outputs[call] ?? "";
      call++;
      return makeChild({ stdout, exitCode: 0 });
    });

    const result = await runSimplify({
      recentEdits: "diff body here",
    });
    expect(result.findings.length).toBe(3);
    expect(result.consensusFixes.length).toBe(1);
    expect(result.consensusFixes[0]).toMatch(/unused export/);
  });

  it("returns empty findings if all reviewers time out", async () => {
    mockSpawn.mockImplementation(() => makeChild({ hangs: true }));
    const result = await runSimplify({
      recentEdits: "diff",
      reviewerCount: 1,
      timeoutMs: 30,
    });
    expect(result.findings).toEqual([]);
    expect(result.consensusFixes).toEqual([]);
  });

  it("clamps reviewerCount to the available reviewer set", async () => {
    mockSpawn.mockImplementation(() => makeChild({ stdout: "", exitCode: 0 }));
    await runSimplify({
      recentEdits: "diff",
      reviewerCount: 99,
    });
    expect(mockSpawn).toHaveBeenCalledTimes(3);
  });
});
