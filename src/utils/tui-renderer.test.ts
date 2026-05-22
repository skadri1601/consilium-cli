import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTUI, __TUI_INTERNALS__ } from "./tui-renderer";

const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g;
const stripAnsi = (s: string): string => s.replace(ANSI_RE, "");

interface CapturedWrites {
  data: string[];
  spy: ReturnType<typeof vi.spyOn>;
}

function captureStdout(): CapturedWrites {
  const data: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown): boolean => {
      data.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    });
  return { data, spy };
}

function setTTY(value: boolean): void {
  Object.defineProperty(process.stdout, "isTTY", {
    value,
    configurable: true,
    writable: true,
  });
}

describe("tui-renderer", () => {
  const originalIsTTY = process.stdout.isTTY;
  const originalRows = process.stdout.rows;
  const originalOn = process.on;

  beforeEach(() => {
    __TUI_INTERNALS__.reset();
    __TUI_INTERNALS__.setExitHandlersInstalled(true);
    setTTY(true);
    Object.defineProperty(process.stdout, "rows", {
      value: 24,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    const tui = getTUI();
    if (tui.isActive()) tui.leave();
    __TUI_INTERNALS__.reset();
    __TUI_INTERNALS__.setExitHandlersInstalled(false);
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalIsTTY,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(process.stdout, "rows", {
      value: originalRows,
      configurable: true,
      writable: true,
    });
    process.on = originalOn;
    vi.restoreAllMocks();
  });

  it("starts inactive", () => {
    expect(getTUI().isActive()).toBe(false);
  });

  it("enter() activates and emits alt-screen + cursor sequences", () => {
    const cap = captureStdout();
    const tui = getTUI();
    tui.enter();
    expect(tui.isActive()).toBe(true);
    const out = cap.data.join("");
    expect(out).toContain(__TUI_INTERNALS__.sequences.ALT_SCREEN_ENTER);
    expect(out).toContain(__TUI_INTERNALS__.sequences.CURSOR_SAVE);
    expect(out).toContain(__TUI_INTERNALS__.sequences.CURSOR_HOME);
    expect(out).toContain(__TUI_INTERNALS__.sequences.ERASE_SCREEN);
  });

  it("leave() deactivates and restores the original screen", () => {
    const tui = getTUI();
    tui.enter();
    const cap = captureStdout();
    tui.leave();
    expect(tui.isActive()).toBe(false);
    const out = cap.data.join("");
    expect(out).toContain(__TUI_INTERNALS__.sequences.ALT_SCREEN_LEAVE);
    expect(out).toContain(__TUI_INTERNALS__.sequences.CURSOR_RESTORE);
    expect(out).toContain(__TUI_INTERNALS__.sequences.CURSOR_SHOW);
  });

  it("toggle on/off updates isActive() correctly", () => {
    const tui = getTUI();
    expect(tui.isActive()).toBe(false);
    tui.enter();
    expect(tui.isActive()).toBe(true);
    tui.leave();
    expect(tui.isActive()).toBe(false);
    tui.enter();
    expect(tui.isActive()).toBe(true);
  });

  it("enter() is idempotent", () => {
    const tui = getTUI();
    tui.enter();
    const cap = captureStdout();
    tui.enter();
    expect(cap.data.join("")).toBe("");
    expect(tui.isActive()).toBe(true);
  });

  it("leave() is idempotent when not active", () => {
    const cap = captureStdout();
    getTUI().leave();
    expect(cap.data.join("")).toBe("");
  });

  it("clear() erases screen when active", () => {
    const tui = getTUI();
    tui.enter();
    const cap = captureStdout();
    tui.clear();
    const out = cap.data.join("");
    expect(out).toContain(__TUI_INTERNALS__.sequences.CURSOR_HOME);
    expect(out).toContain(__TUI_INTERNALS__.sequences.ERASE_SCREEN);
  });

  it("clear() is a no-op when not active", () => {
    const cap = captureStdout();
    getTUI().clear();
    expect(cap.data.join("")).toBe("");
  });

  it("render() writes content and includes expected escape sequences", () => {
    const tui = getTUI();
    tui.enter();
    const cap = captureStdout();
    tui.render("Hello\nWorld");
    const out = cap.data.join("");
    expect(out).toContain(__TUI_INTERNALS__.sequences.CURSOR_HIDE);
    expect(out).toContain(__TUI_INTERNALS__.sequences.CURSOR_HOME);
    expect(out).toContain(__TUI_INTERNALS__.sequences.ERASE_SCREEN);
    expect(out).toContain(__TUI_INTERNALS__.sequences.CURSOR_SHOW);
    expect(stripAnsi(out)).toContain("Hello\nWorld");
  });

  it("render() is a no-op when not active", () => {
    const cap = captureStdout();
    getTUI().render("nothing");
    expect(cap.data.join("")).toBe("");
  });

  it("render({ preserveBottom: 2 }) leaves last rows untouched and positions cursor", () => {
    Object.defineProperty(process.stdout, "rows", {
      value: 30,
      configurable: true,
      writable: true,
    });
    const tui = getTUI();
    tui.enter();
    const cap = captureStdout();
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join(
      "\n",
    );
    tui.render(lines, { preserveBottom: 2 });
    const out = cap.data.join("");
    expect(stripAnsi(out)).toContain("line 1");
    expect(stripAnsi(out)).toContain("line 28");
    expect(stripAnsi(out)).not.toContain("line 30");
    expect(out).toMatch(/\x1b\[29;1H/);
  });

  it("render() handles missing rows gracefully (default 24)", () => {
    Object.defineProperty(process.stdout, "rows", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const tui = getTUI();
    tui.enter();
    const cap = captureStdout();
    tui.render("Hello", { preserveBottom: 0 });
    expect(stripAnsi(cap.data.join(""))).toContain("Hello");
  });

  it("installs exit + signal handlers on first enter()", () => {
    __TUI_INTERNALS__.setExitHandlersInstalled(false);
    const registered: string[] = [];
    const fakeOn = vi.fn(
      (event: string | symbol, _listener: (...args: unknown[]) => void) => {
        registered.push(String(event));
        return process;
      },
    );
    process.on = fakeOn as unknown as typeof process.on;
    const tui = getTUI();
    tui.enter();
    expect(registered).toContain("exit");
    expect(registered).toContain("SIGINT");
    expect(registered).toContain("SIGTERM");
  });

  it("exit handler cleans up the terminal when triggered", () => {
    __TUI_INTERNALS__.setExitHandlersInstalled(false);
    let exitHandler: (() => void) | undefined;
    const fakeOn = vi.fn(
      (event: string | symbol, listener: (...args: unknown[]) => void) => {
        if (event === "exit") exitHandler = listener as () => void;
        return process;
      },
    );
    process.on = fakeOn as unknown as typeof process.on;
    const tui = getTUI();
    tui.enter();
    expect(tui.isActive()).toBe(true);

    const cap = captureStdout();
    expect(exitHandler).toBeDefined();
    exitHandler?.();
    expect(tui.isActive()).toBe(false);
    const out = cap.data.join("");
    expect(out).toContain(__TUI_INTERNALS__.sequences.ALT_SCREEN_LEAVE);
    expect(out).toContain(__TUI_INTERNALS__.sequences.CURSOR_SHOW);
  });
});
