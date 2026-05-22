import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  navigateDiffs,
  parseUnifiedDiff,
  renderHunk,
  renderStatusLine,
  type DiffHunk,
} from "./diff-navigator";

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string): string => s.replace(ANSI_RE, "");

const SAMPLE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index 1111111..2222222 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,4 +1,5 @@
 export function foo() {
-  return 1;
+  return 2;
+  // new line
 }

diff --git a/src/bar.ts b/src/bar.ts
index 3333333..4444444 100644
--- a/src/bar.ts
+++ b/src/bar.ts
@@ -10,3 +10,4 @@ function bar() {
   const a = 1;
+  const b = 2;
   return a;
 }
@@ -20,2 +21,3 @@ function bar() {
   x();
+  y();
   z();
`;

describe("parseUnifiedDiff", () => {
  it("returns empty array on empty input", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });

  it("counts hunks correctly across multiple files", () => {
    const hunks = parseUnifiedDiff(SAMPLE_DIFF);
    expect(hunks).toHaveLength(3);
  });

  it("extracts file paths from b/ side of the diff", () => {
    const hunks = parseUnifiedDiff(SAMPLE_DIFF);
    expect(hunks[0]!.filePath).toBe("src/foo.ts");
    expect(hunks[1]!.filePath).toBe("src/bar.ts");
    expect(hunks[2]!.filePath).toBe("src/bar.ts");
  });

  it("parses oldStart and newStart line numbers", () => {
    const hunks = parseUnifiedDiff(SAMPLE_DIFF);
    expect(hunks[0]!.oldStart).toBe(1);
    expect(hunks[0]!.newStart).toBe(1);
    expect(hunks[1]!.oldStart).toBe(10);
    expect(hunks[1]!.newStart).toBe(10);
    expect(hunks[2]!.oldStart).toBe(20);
    expect(hunks[2]!.newStart).toBe(21);
  });

  it("includes +/- prefixes in hunk lines", () => {
    const hunks = parseUnifiedDiff(SAMPLE_DIFF);
    const fooLines = hunks[0]!.lines;
    expect(fooLines).toContain("-  return 1;");
    expect(fooLines).toContain("+  return 2;");
    expect(fooLines).toContain("+  // new line");
  });

  it("round-trips a known minimal diff", () => {
    const minimal = [
      "--- a/x.txt",
      "+++ b/x.txt",
      "@@ -1,2 +1,2 @@",
      "-hello",
      "+world",
      " end",
    ].join("\n");
    const hunks = parseUnifiedDiff(minimal);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toEqual({
      filePath: "x.txt",
      oldStart: 1,
      newStart: 1,
      lines: ["-hello", "+world", " end"],
    });
  });

  it("handles diff without diff --git header (raw unified diff)", () => {
    const raw = [
      "--- a/only.ts",
      "+++ b/only.ts",
      "@@ -5 +5 @@",
      "-old",
      "+new",
    ].join("\n");
    const hunks = parseUnifiedDiff(raw);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.filePath).toBe("only.ts");
    expect(hunks[0]!.oldStart).toBe(5);
  });

  it("ignores noise lines (binary markers, index lines) outside hunks", () => {
    const noisy = [
      "diff --git a/n.ts b/n.ts",
      "index abc..def 100644",
      "--- a/n.ts",
      "+++ b/n.ts",
      "@@ -1 +1 @@",
      "-a",
      "+b",
    ].join("\n");
    const hunks = parseUnifiedDiff(noisy);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.lines).toEqual(["-a", "+b"]);
  });
});

describe("renderHunk / renderStatusLine", () => {
  const hunk: DiffHunk = {
    filePath: "src/x.ts",
    oldStart: 10,
    newStart: 12,
    lines: [" context", "-old line", "+new line"],
  };

  it("renderHunk applies green to additions and red to removals", () => {
    const out = renderHunk(hunk, 0, 2);
    expect(out).toContain("\x1b[32m+new line\x1b[0m");
    expect(out).toContain("\x1b[31m-old line\x1b[0m");
  });

  it("renderHunk header contains file path, line numbers, position", () => {
    const stripped = stripAnsi(renderHunk(hunk, 0, 2));
    expect(stripped).toContain("src/x.ts");
    expect(stripped).toContain("@@ -10 +12 @@");
    expect(stripped).toContain("(hunk 1/2)");
  });

  it("renderStatusLine has 1-based position, file path, key hints", () => {
    const stripped = stripAnsi(renderStatusLine(hunk, 1, 3));
    expect(stripped).toContain("Hunk 2/3");
    expect(stripped).toContain("src/x.ts");
    expect(stripped).toContain("j/k navigate");
    expect(stripped).toContain("q quit");
  });
});

describe("navigateDiffs (non-TTY fallback)", () => {
  it("prints all hunks sequentially when stdin is not a TTY", async () => {
    const stdin = new PassThrough() as unknown as NodeJS.ReadStream;
    (stdin as unknown as { isTTY?: boolean }).isTTY = false;

    let captured = "";
    const stdout = new EventEmitter() as unknown as NodeJS.WriteStream;
    (stdout as unknown as { write: (s: string) => boolean }).write = (
      s: string,
    ) => {
      captured += s;
      return true;
    };

    const hunks: DiffHunk[] = [
      {
        filePath: "a.ts",
        oldStart: 1,
        newStart: 1,
        lines: ["-a", "+b"],
      },
      {
        filePath: "b.ts",
        oldStart: 2,
        newStart: 2,
        lines: [" c", "+d"],
      },
    ];

    await navigateDiffs(hunks, { stdin, stdout });
    const stripped = stripAnsi(captured);
    expect(stripped).toContain("a.ts");
    expect(stripped).toContain("b.ts");
    expect(stripped).toContain("-a");
    expect(stripped).toContain("+b");
    expect(stripped).toContain("+d");
  });

  it("prints friendly notice when given an empty hunk list", async () => {
    const stdin = new PassThrough() as unknown as NodeJS.ReadStream;
    (stdin as unknown as { isTTY?: boolean }).isTTY = false;
    let captured = "";
    const stdout = new EventEmitter() as unknown as NodeJS.WriteStream;
    (stdout as unknown as { write: (s: string) => boolean }).write = (
      s: string,
    ) => {
      captured += s;
      return true;
    };
    await navigateDiffs([], { stdin, stdout });
    expect(captured).toContain("No diff hunks");
  });
});
