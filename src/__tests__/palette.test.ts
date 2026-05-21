import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/visual-system.js", () => {
  const identity = (s: string) => s;
  return {
    style: () => ({
      brand: identity,
      dim: identity,
      bold: identity,
      success: identity,
      error: identity,
      warning: identity,
    }),
    COLORS: {
      brand: "#6366f1",
      success: "#10b981",
      error: "#ef4444",
      warning: "#f59e0b",
      text: { primary: "#e5e7eb", secondary: "#9ca3af", tertiary: "#6b7280" },
    },
  };
});

vi.mock("../utils/terminal-capabilities.js", () => ({
  terminal: {
    width: 80,
    isTTY: true,
    hasColor: false,
    hasUnicode: true,
    isCI: false,
    usePlain: false,
    isWindows: false,
  },
  boxChars: () => ({
    horizontal: "─",
    vertical: "│",
    topLeft: "┌",
    topRight: "┐",
    bottomLeft: "└",
    bottomRight: "┘",
  }),
}));

import {
  isPaletteOpen,
  paletteQuery,
  visibleMatches,
  renderPrompt,
  renderFrame,
  clampPaletteIndex,
  createState,
  type PaletteState,
} from "../repl/palette";

describe("isPaletteOpen", () => {
  it('returns true for "/" prefix without space', () => {
    expect(isPaletteOpen("/")).toBe(true);
    expect(isPaletteOpen("/he")).toBe(true);
    expect(isPaletteOpen("/config")).toBe(true);
  });

  it('returns false for "/ text" (slash followed by space)', () => {
    expect(isPaletteOpen("/ text")).toBe(false);
    expect(isPaletteOpen("/config set key")).toBe(false);
  });

  it("returns false for non-slash input", () => {
    expect(isPaletteOpen("")).toBe(false);
    expect(isPaletteOpen("hello")).toBe(false);
    expect(isPaletteOpen("some text")).toBe(false);
  });
});

describe("paletteQuery", () => {
  it('extracts query after "/"', () => {
    expect(paletteQuery("/he")).toBe("he");
    expect(paletteQuery("/config")).toBe("config");
    expect(paletteQuery("/")).toBe("");
  });

  it("returns empty string for non-slash input", () => {
    expect(paletteQuery("")).toBe("");
    expect(paletteQuery("hello")).toBe("");
  });
});

describe("visibleMatches", () => {
  it('returns all commands for bare "/"', () => {
    const matches = visibleMatches("/");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("filters by query", () => {
    const matches = visibleMatches("/he");
    expect(
      matches.every(
        (m) => m.name.includes("he") || m.summary.toLowerCase().includes("he"),
      ),
    ).toBe(true);
  });

  it("returns empty for non-palette input", () => {
    expect(visibleMatches("")).toEqual([]);
    expect(visibleMatches("hello")).toEqual([]);
    expect(visibleMatches("/config set key")).toEqual([]);
  });
});

describe("renderPrompt", () => {
  it("renders horizontal rule and prompt marker", () => {
    const result = renderPrompt("");
    expect(result).toContain("─".repeat(80));
    expect(result).toContain("❯");
  });

  it('includes "? for shortcuts" hint when buffer is empty', () => {
    const result = renderPrompt("");
    expect(result).toContain("? for shortcuts");
  });

  it("omits hint when buffer has text", () => {
    const result = renderPrompt("hello");
    expect(result).not.toContain("? for shortcuts");
    expect(result).toContain("hello");
  });
});

describe("renderFrame", () => {
  it("returns frame string and correct line count", () => {
    const state: PaletteState = { buffer: "", paletteIndex: 0, prevLines: 0 };
    const { frame, lines } = renderFrame(state);
    expect(typeof frame).toBe("string");
    expect(typeof lines).toBe("number");
    expect(lines).toBe((frame.match(/\n/g) ?? []).length);
  });

  it('includes palette content for "/" buffer', () => {
    const state: PaletteState = { buffer: "/", paletteIndex: 0, prevLines: 0 };
    const { frame } = renderFrame(state);
    expect(frame).toContain("❯");
    expect(frame).toContain("navigate");
  });

  it("excludes palette content for non-slash buffer", () => {
    const state: PaletteState = {
      buffer: "hello",
      paletteIndex: 0,
      prevLines: 0,
    };
    const { frame } = renderFrame(state);
    expect(frame).not.toContain("navigate");
  });
});

describe("clampPaletteIndex", () => {
  it("clamps index to match count - 1 when exceeding", () => {
    const state: PaletteState = {
      buffer: "/",
      paletteIndex: 999,
      prevLines: 0,
    };
    clampPaletteIndex(state);
    const matches = visibleMatches("/");
    expect(state.paletteIndex).toBe(matches.length - 1);
  });

  it("clamps negative index to 0", () => {
    const state: PaletteState = { buffer: "/", paletteIndex: -5, prevLines: 0 };
    clampPaletteIndex(state);
    expect(state.paletteIndex).toBe(0);
  });

  it("resets to 0 when no matches", () => {
    const state: PaletteState = {
      buffer: "/zzzzzzzznotacommand",
      paletteIndex: 3,
      prevLines: 0,
    };
    clampPaletteIndex(state);
    expect(state.paletteIndex).toBe(0);
  });

  it("preserves valid index", () => {
    const state: PaletteState = { buffer: "/", paletteIndex: 2, prevLines: 0 };
    clampPaletteIndex(state);
    expect(state.paletteIndex).toBe(2);
  });
});

describe("scrolling window", () => {
  it("shows scroll indicators when paletteIndex > 8", () => {
    const matches = visibleMatches("/");
    if (matches.length <= 8) return;

    const state: PaletteState = { buffer: "/", paletteIndex: 9, prevLines: 0 };
    clampPaletteIndex(state);
    const { frame } = renderFrame(state);

    expect(frame).toContain("↑");
    expect(frame).toContain("more");
  });

  it("shows down indicator when scrolled above the bottom", () => {
    const matches = visibleMatches("/");
    if (matches.length <= 8) return;

    const state: PaletteState = { buffer: "/", paletteIndex: 0, prevLines: 0 };
    const { frame } = renderFrame(state);

    expect(frame).toContain("↓");
    expect(frame).toContain("more");
  });
});
