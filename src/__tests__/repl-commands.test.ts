import { describe, it, expect } from "vitest";
import { ALL_COMMANDS, filterCommands, findCommand } from "../repl/commands";
import {
  isPaletteOpen,
  paletteQuery,
  visibleMatches,
  createState,
  clampPaletteIndex,
} from "../repl/palette";

describe("slash command registry", () => {
  it("includes all 8 deliberation modes", () => {
    const modeNames = [
      "auto",
      "quick",
      "council",
      "deep",
      "blind",
      "redteam",
      "jury",
      "market",
    ];
    for (const name of modeNames) {
      expect(findCommand(name)).toBeDefined();
    }
  });

  it("includes core utility commands", () => {
    for (const name of [
      "chat",
      "stats",
      "config",
      "login",
      "logout",
      "help",
      "exit",
      "clear",
    ]) {
      expect(findCommand(name)).toBeDefined();
    }
  });

  it("findCommand is case-insensitive", () => {
    expect(findCommand("AUTO")?.name).toBe("auto");
    expect(findCommand("Help")?.name).toBe("help");
  });

  it("findCommand returns undefined for unknown names", () => {
    expect(findCommand("nope")).toBeUndefined();
  });

  it("every command has a usage string", () => {
    for (const c of ALL_COMMANDS) {
      expect(c.usage).toBeTruthy();
      expect(c.usage!.startsWith("/")).toBe(true);
    }
  });
});

describe("filterCommands", () => {
  it("returns full registry on empty query", () => {
    expect(filterCommands("").length).toBe(ALL_COMMANDS.length);
  });

  it("ranks startsWith matches before substring matches", () => {
    const matches = filterCommands("re");
    expect(matches[0]?.name).toBe("redteam");
  });

  it("matches by summary fragment", () => {
    const matches = filterCommands("adversarial");
    expect(matches.some((c) => c.name === "redteam")).toBe(true);
  });

  it("returns empty array for non-matching query", () => {
    expect(filterCommands("zzznope")).toEqual([]);
  });
});

describe("palette state", () => {
  it("isPaletteOpen is true when buffer starts with / and has no space", () => {
    expect(isPaletteOpen("/")).toBe(true);
    expect(isPaletteOpen("/qu")).toBe(true);
    expect(isPaletteOpen("/quick")).toBe(true);
    expect(isPaletteOpen("/quick ")).toBe(false);
    expect(isPaletteOpen("/quick topic")).toBe(false);
    expect(isPaletteOpen("auto")).toBe(false);
    expect(isPaletteOpen("")).toBe(false);
  });

  it("paletteQuery strips the leading slash", () => {
    expect(paletteQuery("/qui")).toBe("qui");
    expect(paletteQuery("/")).toBe("");
    expect(paletteQuery("nope")).toBe("");
  });

  it("visibleMatches narrows as user types", () => {
    expect(visibleMatches("/").length).toBe(ALL_COMMANDS.length);
    const q = visibleMatches("/qu");
    expect(q.some((c) => c.name === "quick")).toBe(true);
    expect(q.length).toBeLessThan(ALL_COMMANDS.length);
  });

  it("clampPaletteIndex keeps index within match bounds", () => {
    const state = createState();
    state.buffer = "/qu";
    state.paletteIndex = 999;
    clampPaletteIndex(state);
    const matches = visibleMatches(state.buffer);
    expect(state.paletteIndex).toBeLessThan(Math.max(matches.length, 1));
  });
});
