import readline from "node:readline";

export interface DiffHunk {
  filePath: string;
  oldStart: number;
  newStart: number;
  lines: string[];
}

export interface NavigateOptions {
  onApply?: (hunk: DiffHunk, index: number) => void | Promise<void>;
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
}

const ANSI_RESET = "\x1b[0m";
const ANSI_GREEN = "\x1b[32m";
const ANSI_RED = "\x1b[31m";
const ANSI_DIM = "\x1b[2m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_CYAN = "\x1b[36m";
const CLEAR_SCREEN = "\x1b[2J\x1b[H";

const HUNK_HEADER_RE = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

function colorLine(line: string): string {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return `${ANSI_GREEN}${line}${ANSI_RESET}`;
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return `${ANSI_RED}${line}${ANSI_RESET}`;
  }
  return `${ANSI_DIM}${line}${ANSI_RESET}`;
}

export function renderHunk(
  hunk: DiffHunk,
  index: number,
  total: number,
): string {
  const lines: string[] = [];
  lines.push(`${ANSI_BOLD}${ANSI_CYAN}── ${hunk.filePath} ──${ANSI_RESET}`);
  lines.push(
    `${ANSI_DIM}@@ -${hunk.oldStart} +${hunk.newStart} @@ (hunk ${index + 1}/${total})${ANSI_RESET}`,
  );
  for (const line of hunk.lines) {
    lines.push(colorLine(line));
  }
  return lines.join("\n");
}

export function renderStatusLine(
  hunk: DiffHunk,
  index: number,
  total: number,
): string {
  return `${ANSI_BOLD}Hunk ${index + 1}/${total}${ANSI_RESET} — ${hunk.filePath} — ${ANSI_DIM}[j/k navigate, a apply, ? help, q quit]${ANSI_RESET}`;
}

function helpText(): string {
  return [
    "",
    `${ANSI_BOLD}Diff navigator keys${ANSI_RESET}`,
    "  j, n, ↓   next hunk",
    "  k, p, ↑   previous hunk",
    "  a         apply this hunk (if handler is configured)",
    "  ?         show this help",
    "  q, Esc    quit",
    "",
    `${ANSI_DIM}Press any key to continue…${ANSI_RESET}`,
  ].join("\n");
}

export function parseUnifiedDiff(diff: string): DiffHunk[] {
  if (!diff) return [];
  const lines = diff.split(/\r?\n/);
  const hunks: DiffHunk[] = [];

  let currentFile = "";
  let current: DiffHunk | null = null;

  const flush = () => {
    if (current) {
      hunks.push(current);
      current = null;
    }
  };

  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      flush();
      const match = line.match(/diff --git a\/(.+?) b\/(.+)$/);
      if (match) {
        currentFile = match[2] ?? match[1] ?? "";
      }
      continue;
    }
    if (line.startsWith("+++ ")) {
      flush();
      const rest = line.slice(4).trim();
      if (rest && rest !== "/dev/null") {
        currentFile = rest.startsWith("b/") ? rest.slice(2) : rest;
      }
      continue;
    }
    if (line.startsWith("--- ")) {
      flush();
      if (!currentFile) {
        const rest = line.slice(4).trim();
        if (rest && rest !== "/dev/null") {
          currentFile = rest.startsWith("a/") ? rest.slice(2) : rest;
        }
      }
      continue;
    }
    const header = line.match(HUNK_HEADER_RE);
    if (header) {
      flush();
      current = {
        filePath: currentFile || "unknown",
        oldStart: Number.parseInt(header[1] ?? "0", 10),
        newStart: Number.parseInt(header[3] ?? "0", 10),
        lines: [],
      };
      continue;
    }
    if (current) {
      if (
        line.startsWith("+") ||
        line.startsWith("-") ||
        line.startsWith(" ") ||
        line === "" ||
        line === "\\ No newline at end of file"
      ) {
        current.lines.push(line);
      }
    }
  }
  flush();
  return hunks;
}

async function printAllHunksFallback(
  hunks: DiffHunk[],
  stdout: NodeJS.WriteStream,
): Promise<void> {
  for (let i = 0; i < hunks.length; i += 1) {
    const hunk = hunks[i]!;
    stdout.write(renderHunk(hunk, i, hunks.length));
    stdout.write("\n\n");
  }
}

interface KeyEvent {
  name?: string;
  sequence?: string;
}

export async function navigateDiffs(
  hunks: DiffHunk[],
  options: NavigateOptions = {},
): Promise<void> {
  const stdout = options.stdout ?? process.stdout;
  const stdin = options.stdin ?? process.stdin;

  if (hunks.length === 0) {
    stdout.write("No diff hunks to display.\n");
    return;
  }

  const isTty =
    typeof (stdin as NodeJS.ReadStream).isTTY === "boolean" &&
    (stdin as NodeJS.ReadStream).isTTY === true &&
    typeof (stdin as NodeJS.ReadStream).setRawMode === "function";

  if (!isTty) {
    await printAllHunksFallback(hunks, stdout);
    return;
  }

  let index = 0;
  let showingHelp = false;

  const draw = () => {
    stdout.write(CLEAR_SCREEN);
    const hunk = hunks[index]!;
    stdout.write(renderHunk(hunk, index, hunks.length));
    stdout.write("\n\n");
    stdout.write(renderStatusLine(hunk, index, hunks.length));
    stdout.write("\n");
    if (showingHelp) {
      stdout.write(helpText());
      stdout.write("\n");
    }
  };

  readline.emitKeypressEvents(stdin);
  const previousRaw = stdin.isRaw === true;
  stdin.setRawMode(true);
  stdin.resume();

  try {
    draw();
    await new Promise<void>((resolve, reject) => {
      const onKey = (_str: string | undefined, key: KeyEvent | undefined) => {
        try {
          if (!key) return;
          if (showingHelp) {
            showingHelp = false;
            draw();
            return;
          }
          if (key.sequence === "") {
            cleanup();
            resolve();
            return;
          }
          const name = key.name ?? "";
          if (name === "q" || name === "escape") {
            cleanup();
            resolve();
            return;
          }
          if (name === "j" || name === "n" || name === "down") {
            if (index < hunks.length - 1) {
              index += 1;
              draw();
            }
            return;
          }
          if (name === "k" || name === "p" || name === "up") {
            if (index > 0) {
              index -= 1;
              draw();
            }
            return;
          }
          if (name === "a") {
            if (options.onApply) {
              Promise.resolve(options.onApply(hunks[index]!, index)).catch(
                () => {
                  /* swallow handler errors so navigator stays responsive */
                },
              );
            }
            return;
          }
          if (key.sequence === "?" || name === "slash") {
            showingHelp = true;
            draw();
            return;
          }
        } catch (err) {
          cleanup();
          reject(err);
        }
      };

      const cleanup = () => {
        stdin.removeListener("keypress", onKey);
      };

      stdin.on("keypress", onKey);
    });
  } finally {
    try {
      stdin.setRawMode(previousRaw);
    } catch {
      /* stdin may be closed */
    }
    stdin.pause();
  }
}
