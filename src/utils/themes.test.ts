import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./terminal-capabilities", () => ({
  terminal: {
    hasColor: false,
    isCI: false,
    isTTY: false,
    isWindows: false,
    hasUnicode: true,
    usePlain: true,
    width: 80,
  },
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(() => "{}"),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      renameSync: vi.fn(),
    },
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => "{}"),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
  };
});

const ORIGINAL_THEME = process.env.CONSILIUM_THEME;

let mod: typeof import("./themes");

beforeEach(async () => {
  vi.resetModules();
  delete process.env.CONSILIUM_THEME;
  mod = await import("./themes");
  mod._resetForTests();
});

afterEach(() => {
  if (ORIGINAL_THEME === undefined) delete process.env.CONSILIUM_THEME;
  else process.env.CONSILIUM_THEME = ORIGINAL_THEME;
  mod._resetForTests();
});

describe("themes registry", () => {
  it("exposes default, dark, light, and high-contrast themes", () => {
    const names = mod.listThemeNames();
    expect(names).toContain("default");
    expect(names).toContain("dark");
    expect(names).toContain("light");
    expect(names).toContain("high-contrast");
  });

  it("exposes matrix, ocean, sunset, and monokai themes", () => {
    const names = mod.listThemeNames();
    expect(names).toContain("matrix");
    expect(names).toContain("ocean");
    expect(names).toContain("sunset");
    expect(names).toContain("monokai");
  });

  it.each(["matrix", "ocean", "sunset", "monokai"])(
    "%s theme is gettable via THEMES and THEME_PALETTES",
    (name) => {
      const theme = mod.THEMES[name];
      expect(theme).toBeDefined();
      expect(typeof theme!.brand).toBe("function");
      const palette = mod.THEME_PALETTES[name];
      expect(palette).toBeDefined();
      expect(palette!.brand).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(palette!.success).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(palette!.error).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(palette!.warning).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(palette!.text).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(palette!.dimText).toMatch(/^#[0-9a-fA-F]{6}$/);
    },
  );

  it.each(["matrix", "ocean", "sunset", "monokai"])(
    "setActiveTheme accepts %s",
    (name) => {
      mod.setActiveTheme(name);
      expect(mod.getActiveThemeName()).toBe(name);
    },
  );

  it("provides identity functions when color is disabled", () => {
    const theme = mod.THEMES.default!;
    expect(theme.brand("x")).toBe("x");
    expect(theme.dim("x")).toBe("x");
    expect(theme.success("x")).toBe("x");
    expect(theme.warning("x")).toBe("x");
    expect(theme.error("x")).toBe("x");
    expect(theme.bold("x")).toBe("x");
  });

  it("THEME_PALETTES exposes brand/text colors for each theme", () => {
    const palette = mod.THEME_PALETTES.dark!;
    expect(palette.brand).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(palette.success).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

describe("getActiveTheme / getActiveThemeName", () => {
  it("defaults to 'default' when nothing is set", () => {
    expect(mod.getActiveThemeName()).toBe("default");
  });

  it("uses CONSILIUM_THEME env var when valid", () => {
    process.env.CONSILIUM_THEME = "dark";
    mod._resetForTests();
    expect(mod.getActiveThemeName()).toBe("dark");
  });

  it("ignores unknown CONSILIUM_THEME values", () => {
    process.env.CONSILIUM_THEME = "nonexistent";
    mod._resetForTests();
    expect(mod.getActiveThemeName()).toBe("default");
  });

  it("getActiveTheme returns a Theme object with all functions", () => {
    const theme = mod.getActiveTheme();
    expect(typeof theme.brand).toBe("function");
    expect(typeof theme.dim).toBe("function");
    expect(typeof theme.success).toBe("function");
    expect(typeof theme.warning).toBe("function");
    expect(typeof theme.error).toBe("function");
    expect(typeof theme.bold).toBe("function");
  });

  it("getActivePalette returns a ThemePalette object", () => {
    const palette = mod.getActivePalette();
    expect(palette.brand).toMatch(/^#/);
    expect(palette.text).toMatch(/^#/);
  });
});

describe("setActiveTheme", () => {
  it("changes the active theme name", () => {
    mod.setActiveTheme("light");
    expect(mod.getActiveThemeName()).toBe("light");
  });

  it("throws on unknown theme name", () => {
    expect(() => mod.setActiveTheme("bogus")).toThrow(/Unknown theme/);
  });
});
