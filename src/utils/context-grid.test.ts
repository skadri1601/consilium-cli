import { describe, expect, it } from "vitest";
import {
  renderContextGrid,
  renderContextSummary,
  type TokenUsage,
} from "./context-grid";

const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

describe("renderContextSummary", () => {
  it("shows used / limit and percentage", () => {
    const out = renderContextSummary({ used: 47832, limit: 200000 });
    expect(stripAnsi(out)).toBe("Context: 47,832 / 200,000 tokens (24%)");
  });

  it("clamps used above limit to limit and reports 100%", () => {
    const out = renderContextSummary({ used: 999999, limit: 100000 });
    expect(stripAnsi(out)).toContain("100,000 / 100,000");
    expect(stripAnsi(out)).toContain("(100%)");
  });

  it("treats negative used as zero", () => {
    const out = renderContextSummary({ used: -10, limit: 1000 });
    expect(stripAnsi(out)).toContain("(0%)");
  });
});

describe("renderContextGrid", () => {
  it("default grid is 60 wide x 8 rows plus 3 chrome lines (header, top, bottom) + legend", () => {
    const out = renderContextGrid({ used: 0, limit: 200000 });
    const lines = out.split("\n");
    expect(lines).toHaveLength(1 + 1 + 8 + 1 + 1);
    expect(lines[1]).toContain("┌");
    expect(lines[1]).toContain("┐");
    expect(lines[10]).toContain("└");
    expect(lines[10]).toContain("┘");
  });

  it("respects custom width and height options", () => {
    const out = renderContextGrid(
      { used: 0, limit: 1000 },
      { width: 20, height: 3 },
    );
    const lines = out.split("\n");
    expect(lines).toHaveLength(1 + 1 + 3 + 1 + 1);
    const stripped = stripAnsi(lines[1]!);
    expect(stripped.length).toBe(22);
  });

  it("fills approximately the right ratio of cells (50%)", () => {
    const out = renderContextGrid(
      { used: 50, limit: 100 },
      { width: 10, height: 2 },
    );
    const stripped = stripAnsi(out);
    const filled = (stripped.match(/█/g) ?? []).length;
    const empty = (stripped.match(/░/g) ?? []).length;
    expect(filled + empty).toBe(20);
    expect(filled).toBe(10);
    expect(empty).toBe(10);
  });

  it("renders zero usage as all-empty cells", () => {
    const out = renderContextGrid(
      { used: 0, limit: 1000 },
      { width: 10, height: 2 },
    );
    const stripped = stripAnsi(out);
    expect((stripped.match(/░/g) ?? []).length).toBe(20);
    expect((stripped.match(/█/g) ?? []).length).toBe(0);
  });

  it("renders full usage as all-filled cells", () => {
    const out = renderContextGrid(
      { used: 1000, limit: 1000 },
      { width: 10, height: 2 },
    );
    const stripped = stripAnsi(out);
    expect((stripped.match(/█/g) ?? []).length).toBe(20);
    expect((stripped.match(/░/g) ?? []).length).toBe(0);
  });

  it("emits ANSI color codes (raw output contains escape sequences)", () => {
    const out = renderContextGrid(
      { used: 50, limit: 100 },
      { width: 10, height: 1 },
    );
    expect(out).toMatch(/\x1b\[\d+/);
  });

  it("uses segment colors when provided", () => {
    const usage: TokenUsage = {
      used: 100,
      limit: 200,
      segments: [
        { label: "system", tokens: 40, color: "system" },
        { label: "user", tokens: 30, color: "user" },
        { label: "assistant", tokens: 30, color: "assistant" },
      ],
    };
    const out = renderContextGrid(usage, { width: 20, height: 2 });
    expect(out).toContain("\x1b[34m");
    expect(out).toContain("\x1b[32m");
    expect(out).toContain("\x1b[36m");
    expect(stripAnsi(out)).toContain("system 40");
    expect(stripAnsi(out)).toContain("free 100");
  });

  it("legend includes free token count", () => {
    const out = renderContextGrid({ used: 25, limit: 100 });
    expect(stripAnsi(out)).toContain("free 75");
  });

  it("at least one filled cell is shown when used > 0 but rounds to 0", () => {
    const out = renderContextGrid(
      { used: 1, limit: 1000000 },
      { width: 10, height: 1 },
    );
    const stripped = stripAnsi(out);
    expect((stripped.match(/█/g) ?? []).length).toBe(1);
  });
});
