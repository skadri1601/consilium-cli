const ESC = "\x1b";
const ALT_SCREEN_ENTER = `${ESC}[?1049h`;
const ALT_SCREEN_LEAVE = `${ESC}[?1049l`;
const CURSOR_SAVE = `${ESC}[s`;
const CURSOR_RESTORE = `${ESC}[u`;
const CURSOR_HIDE = `${ESC}[?25l`;
const CURSOR_SHOW = `${ESC}[?25h`;
const CURSOR_HOME = `${ESC}[H`;
const ERASE_SCREEN = `${ESC}[2J`;

interface TUIState {
  active: boolean;
  exitHandlersInstalled: boolean;
}

const state: TUIState = {
  active: false,
  exitHandlersInstalled: false,
};

export interface TUIMode {
  enter(): void;
  leave(): void;
  clear(): void;
  isActive(): boolean;
  render(content: string, opts?: { preserveBottom?: number }): void;
}

function write(seq: string): void {
  process.stdout.write(seq);
}

function installExitHandlers(): void {
  if (state.exitHandlersInstalled) return;
  state.exitHandlersInstalled = true;

  const cleanup = (): void => {
    if (state.active) {
      write(CURSOR_SHOW);
      write(ALT_SCREEN_LEAVE);
      write(CURSOR_RESTORE);
      state.active = false;
    }
  };

  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });
  process.on("SIGHUP", () => {
    cleanup();
    process.exit(129);
  });
}

const tui: TUIMode = {
  enter(): void {
    if (state.active) return;
    installExitHandlers();
    write(CURSOR_SAVE);
    write(ALT_SCREEN_ENTER);
    write(CURSOR_HOME);
    write(ERASE_SCREEN);
    state.active = true;
  },

  leave(): void {
    if (!state.active) return;
    write(CURSOR_SHOW);
    write(ALT_SCREEN_LEAVE);
    write(CURSOR_RESTORE);
    state.active = false;
  },

  clear(): void {
    if (!state.active) return;
    write(CURSOR_HOME);
    write(ERASE_SCREEN);
  },

  isActive(): boolean {
    return state.active;
  },

  render(content: string, opts?: { preserveBottom?: number }): void {
    if (!state.active) return;
    const preserveBottom = Math.max(0, opts?.preserveBottom ?? 0);
    const rows =
      typeof process.stdout.rows === "number" && process.stdout.rows > 0
        ? process.stdout.rows
        : 24;
    const renderRows = Math.max(1, rows - preserveBottom);

    write(CURSOR_HIDE);
    write(CURSOR_HOME);
    write(ERASE_SCREEN);

    const lines = content.split("\n").slice(0, renderRows);
    write(lines.join("\n"));

    if (preserveBottom > 0) {
      write(`${ESC}[${rows - preserveBottom + 1};1H`);
    }
    write(CURSOR_SHOW);
  },
};

export function getTUI(): TUIMode {
  return tui;
}

export const __TUI_INTERNALS__ = {
  reset(): void {
    state.active = false;
    state.exitHandlersInstalled = false;
  },
  setExitHandlersInstalled(value: boolean): void {
    state.exitHandlersInstalled = value;
  },
  sequences: {
    ALT_SCREEN_ENTER,
    ALT_SCREEN_LEAVE,
    CURSOR_SAVE,
    CURSOR_RESTORE,
    CURSOR_HIDE,
    CURSOR_SHOW,
    CURSOR_HOME,
    ERASE_SCREEN,
  },
};
