import readline from "node:readline";
import { findCommand, filterCommands, type SlashCommand } from "./commands.js";
import {
  clampPaletteIndex,
  createState,
  isPaletteOpen,
  renderFrame,
  visibleMatches,
} from "./palette.js";
import {
  loadConfig,
  isLoggedIn,
  fetchAndCachePreferences,
  getCachedPreferences,
} from "../utils/config.js";

import { style } from "../utils/visual-system.js";
import { terminal } from "../utils/terminal-capabilities.js";

const st = style();

const KEY = {
  CTRL_C: "\x03",
  CTRL_D: "\x04",
  CTRL_L: "\x0c",
  CTRL_U: "\x15",
  ENTER: "\r",
  NEWLINE: "\n",
  BACKSPACE: "\x7f",
  BACKSPACE_ALT: "\b",
  TAB: "\t",
  ESC: "\x1b",
  ARROW_UP: "\x1b[A",
  ARROW_DOWN: "\x1b[B",
  ARROW_RIGHT: "\x1b[C",
  ARROW_LEFT: "\x1b[D",
} as const;

function clearFrame(prevLines: number): void {
  if (prevLines > 0) {
    process.stdout.write(`\x1b[${prevLines}A\r\x1b[0J`);
  } else {
    process.stdout.write(`\r\x1b[0J`);
  }
}

function writeBanner(): void {
  const cfg = loadConfig();
  const name = cfg.userName || "you";
  console.log("");
  console.log(
    `  ${st.bold(`Consilium`)} ${st.dim("· multi-agent council REPL")}`,
  );
  console.log(`  ${st.dim(`Welcome back, ${name}.`)}`);
  console.log("");
  console.log(
    `  ${st.dim("Type")} ${st.brand("/")} ${st.dim("to open the command palette · ")}${st.brand("/help")}${st.dim(" for commands · Ctrl+C to exit")}`,
  );
  console.log("");
}

function isPrintable(ch: string): boolean {
  const code = ch.codePointAt(0);
  return code !== undefined && code >= 0x20 && code !== 0x7f && code !== 0xfeff;
}

interface ParsedInput {
  command: SlashCommand | null;
  args: string;
  unknown?: string;
}

function parseBuffer(buffer: string): ParsedInput {
  const trimmed = buffer.trim();
  if (!trimmed) return { command: null, args: "" };
  if (!trimmed.startsWith("/")) return { command: null, args: trimmed };
  const rest = trimmed.slice(1);
  const spaceIdx = rest.indexOf(" ");
  const name = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
  const args = spaceIdx === -1 ? "" : rest.slice(spaceIdx + 1);
  const cmd = findCommand(name);
  if (!cmd) return { command: null, args, unknown: name };
  return { command: cmd, args };
}

async function runReplFallback(): Promise<void> {
  // Non-TTY: skip raw-mode keystroke capture, the palette UI, and the
  // ANSI redraw cycle. Drop to a line-buffered readline so the REPL
  // still works in IDE consoles, docker exec without -t, recording
  // tools, etc. - the surface a user sees is "type a command per line,
  // press enter, repeat".
  const cfg = loadConfig();
  const userName = cfg.userName || "you";
  console.log("");
  console.log(`  ${st.bold("Consilium")} ${st.dim("· non-interactive mode")}`);
  console.log(`  ${st.dim(`Welcome, ${userName}.`)}`);
  console.log("");
  console.log(
    `  ${st.dim("Type a command (e.g.")} ${st.brand("/help")}${st.dim(", ")}${st.brand("/quick <topic>")}${st.dim(") or type a topic to debate.")}`,
  );
  console.log(
    `  ${st.dim("Tip: a real terminal (TTY) gets the slash-command palette and arrow-key navigation.")}`,
  );
  console.log("");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  const askLine = (): Promise<string | null> =>
    new Promise((resolve) => {
      rl.question("consilium > ", (answer) => resolve(answer));
      rl.once("close", () => resolve(null));
    });

  let running = true;
  while (running) {
    const line = await askLine();
    if (line === null) break;
    const parsed = parseBuffer(line);
    if (!parsed.command && !parsed.args) continue;

    if (parsed.unknown) {
      console.log(st.warning(`Unknown command: /${parsed.unknown}`));
      const suggestions = filterCommands(parsed.unknown).slice(0, 5);
      if (suggestions.length > 0) {
        console.log(st.dim("  Did you mean:"));
        for (const s of suggestions) {
          console.log(st.dim(`    ${s.usage ?? `/${s.name}`} - ${s.summary}`));
        }
      } else {
        console.log(st.dim("  Type /help to list all commands."));
      }
      continue;
    }

    const cmd = parsed.command ?? findCommand("auto");
    if (!cmd) {
      console.log(
        st.warning("No command available - set a default with /help."),
      );
      continue;
    }

    try {
      const result = await cmd.run(parsed.args);
      if (result?.exit) {
        running = false;
        break;
      }
      if (result?.cleared) {
        process.stdout.write("\x1b[2J\x1b[H");
      }
    } catch (err) {
      console.error(st.error(`Command failed: ${(err as Error).message}`));
    }
  }

  rl.close();
}

export async function runRepl(): Promise<void> {
  if (!terminal.isTTY) {
    await runReplFallback();
    return;
  }

  // First-run onboarding: detect the project, prompt for codebase
  // consent, show the one-screen "what is this and how do I try it"
  // pitch. Self-marks done in ~/.consilium/onboarded.json so the user
  // sees this exactly once. Safe no-op on subsequent runs.
  const { runOnboarding } = await import("./onboarding.js");
  await runOnboarding();

  if (isLoggedIn() && !getCachedPreferences()) {
    fetchAndCachePreferences().catch(() => {});
  }

  writeBanner();

  const state = createState();
  let running = true;
  let inFrame = false;

  const drawFrame = (): void => {
    if (inFrame) clearFrame(state.prevLines);
    const { frame, lines } = renderFrame(state);
    process.stdout.write(frame);
    state.prevLines = lines;
    inFrame = true;
  };

  const finalizeFrame = (): void => {
    if (inFrame) {
      process.stdout.write("\n");
      state.prevLines = 0;
      inFrame = false;
    }
  };

  const releaseStdin = (): void => {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdin.removeListener("data", onData);
  };

  const captureStdin = (): void => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
  };

  const executeCommand = async (
    cmd: SlashCommand,
    args: string,
  ): Promise<void> => {
    finalizeFrame();
    releaseStdin();

    const originalExit = process.exit;
    (process as any).exit = ((code?: number) => {
      throw Object.assign(new Error(`process.exit(${code ?? 0})`), {
        __replExit: true,
        code,
      });
    }) as never;

    try {
      const result = await cmd.run(args);
      if (result?.exit) {
        running = false;
        (process as any).exit = originalExit;
        return;
      }
      if (result?.cleared) {
        process.stdout.write("\x1b[2J\x1b[H");
      }
    } catch (err: any) {
      if (err?.__replExit) {
        if (err.code !== 0) {
          console.error(st.error(`Command exited with code ${err.code ?? 1}`));
        }
      } else {
        console.error(st.error(`Command failed: ${(err as Error).message}`));
      }
    } finally {
      (process as any).exit = originalExit;
    }
    if (running) {
      process.stdout.write("\n");
      state.buffer = "";
      state.paletteIndex = 0;
      captureStdin();
      drawFrame();
    }
  };

  function handleEnter(): void {
    if (isPaletteOpen(state.buffer)) {
      const matches = visibleMatches(state.buffer);
      if (matches.length === 0) return;
      const picked = matches[state.paletteIndex] ?? matches[0]!;
      const usage = picked.usage ?? `/${picked.name}`;
      const needsArgs = usage.includes("<") || usage.includes("[");
      if (needsArgs) {
        state.buffer = `/${picked.name} `;
        drawFrame();
      } else {
        state.buffer = `/${picked.name}`;
        drawFrame();
        void executeCommand(picked, "");
      }
      return;
    }

    const parsed = parseBuffer(state.buffer);
    if (!parsed.command && !parsed.args) {
      drawFrame();
      return;
    }
    if (parsed.command) {
      void executeCommand(parsed.command, parsed.args);
      return;
    }
    if (parsed.unknown) {
      finalizeFrame();
      console.log(st.warning(`Unknown command: /${parsed.unknown}`));
      console.log(st.dim("  Type /help to see all commands."));
      state.buffer = "";
      state.paletteIndex = 0;
      drawFrame();
      return;
    }
    const debateCmd = findCommand("auto");
    if (debateCmd) {
      void executeCommand(debateCmd, parsed.args);
    }
  }

  function onData(input: string): void {
    if (input === KEY.CTRL_C || input === KEY.CTRL_D) {
      finalizeFrame();
      console.log(st.dim("bye 👋"));
      running = false;
      releaseStdin();
      return;
    }

    if (input === KEY.CTRL_L) {
      process.stdout.write("\x1b[2J\x1b[H");
      state.prevLines = 0;
      inFrame = false;
      drawFrame();
      return;
    }

    if (input === KEY.CTRL_U) {
      state.buffer = "";
      state.paletteIndex = 0;
      drawFrame();
      return;
    }

    if (input === KEY.ESC) {
      if (state.buffer.length > 0) {
        state.buffer = "";
        state.paletteIndex = 0;
        drawFrame();
      }
      return;
    }

    if (input === KEY.ARROW_UP) {
      if (isPaletteOpen(state.buffer)) {
        const matches = visibleMatches(state.buffer);
        if (matches.length > 0) {
          state.paletteIndex =
            (state.paletteIndex - 1 + matches.length) % matches.length;
          drawFrame();
        }
      }
      return;
    }

    if (input === KEY.ARROW_DOWN) {
      if (isPaletteOpen(state.buffer)) {
        const matches = visibleMatches(state.buffer);
        if (matches.length > 0) {
          state.paletteIndex = (state.paletteIndex + 1) % matches.length;
          drawFrame();
        }
      }
      return;
    }

    if (input === KEY.ARROW_LEFT || input === KEY.ARROW_RIGHT) {
      return;
    }

    if (input === KEY.TAB) {
      if (isPaletteOpen(state.buffer)) {
        const matches = visibleMatches(state.buffer);
        if (matches.length > 0) {
          const picked = matches[state.paletteIndex] ?? matches[0]!;
          state.buffer = `/${picked.name}`;
          drawFrame();
        }
      }
      return;
    }

    if (input === KEY.ENTER || input === KEY.NEWLINE) {
      handleEnter();
      return;
    }

    if (input === KEY.BACKSPACE || input === KEY.BACKSPACE_ALT) {
      if (state.buffer.length > 0) {
        state.buffer = state.buffer.slice(0, -1);
        clampPaletteIndex(state);
        drawFrame();
      }
      return;
    }

    if (input.length > 1 && input[0] === "\x1b") return;

    let typed = "";
    for (const ch of input) {
      if (isPrintable(ch)) typed += ch;
    }
    if (typed.length === 0) return;
    state.buffer += typed;
    state.paletteIndex = 0;
    clampPaletteIndex(state);
    drawFrame();
  }

  captureStdin();
  process.on("exit", () => {
    try {
      process.stdin.setRawMode?.(false);
    } catch {}
  });
  drawFrame();

  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      if (!running) {
        clearInterval(interval);
        try {
          releaseStdin();
        } catch {
          // already released
        }
        resolve();
      }
    }, 100);
  });
}
