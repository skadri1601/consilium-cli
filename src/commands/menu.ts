import readline from "node:readline";
import { DEFAULT_WEB_ORIGIN, loadConfig } from "../utils/config.js";
import { openBrowser } from "../utils/open-browser.js";
import { style } from "../utils/visual-system.js";
import { terminal } from "../utils/terminal-capabilities.js";

const st = style();

interface MenuEntry {
  num: number;
  command: string;
  description: string;
  group: "modes" | "other";
  action:
    | { kind: "debate"; mode: string; promptFor: "topic" }
    | { kind: "redteam"; promptFor: "content" }
    | { kind: "eval"; promptFor: "topic" }
    | { kind: "chat" }
    | { kind: "resume" }
    | { kind: "stats" }
    | { kind: "config" }
    | { kind: "logout" };
}

const MENU: MenuEntry[] = [
  {
    num: 1,
    command: 'consilium debate "<topic>"',
    description: "Council mode - 3 rounds, default",
    group: "modes",
    action: { kind: "debate", mode: "council", promptFor: "topic" },
  },
  {
    num: 2,
    command: 'consilium debate "<topic>" --mode quick',
    description: "Quick - 1 round, fastest (~15s)",
    group: "modes",
    action: { kind: "debate", mode: "quick", promptFor: "topic" },
  },
  {
    num: 3,
    command: 'consilium debate "<topic>" --mode deep',
    description: "Deep - 5 rounds + sub-agent research",
    group: "modes",
    action: { kind: "debate", mode: "deep", promptFor: "topic" },
  },
  {
    num: 4,
    command: 'consilium debate "<topic>" --mode blind',
    description: "Blind - model names hidden until scored",
    group: "modes",
    action: { kind: "debate", mode: "blind", promptFor: "topic" },
  },
  {
    num: 5,
    command: 'consilium debate "<topic>" --mode redteam',
    description: "Redteam - attack/defend cycle for security review",
    group: "modes",
    action: { kind: "redteam", promptFor: "content" },
  },
  {
    num: 6,
    command: 'consilium debate "<topic>" --mode jury',
    description: "Jury - ranked-choice voting (Borda + Condorcet)",
    group: "modes",
    action: { kind: "debate", mode: "jury", promptFor: "topic" },
  },
  {
    num: 7,
    command: 'consilium debate "<topic>" --mode market',
    description: "Market - confidence-weighted probability aggregation",
    group: "modes",
    action: { kind: "debate", mode: "market", promptFor: "topic" },
  },
  {
    num: 8,
    command: 'consilium debate "<topic>" --mode auto',
    description: "Auto - engine picks the best mode for your topic",
    group: "modes",
    action: { kind: "debate", mode: "auto", promptFor: "topic" },
  },
  {
    num: 9,
    command: "consilium chat",
    description: "Interactive REPL with session persistence",
    group: "other",
    action: { kind: "chat" },
  },
  {
    num: 10,
    command: "consilium sessions resume",
    description: "Resume a saved chat session",
    group: "other",
    action: { kind: "resume" },
  },
  {
    num: 11,
    command: "consilium stats",
    description: "Usage statistics across past debates",
    group: "other",
    action: { kind: "stats" },
  },
  {
    num: 12,
    command: 'consilium eval "<topic>"',
    description: "Blind evaluation of provided responses",
    group: "other",
    action: { kind: "eval", promptFor: "topic" },
  },
  {
    num: 13,
    command: "consilium config",
    description: "Open API-key and provider settings",
    group: "other",
    action: { kind: "config" },
  },
  {
    num: 14,
    command: "consilium logout",
    description: "Clear stored credentials",
    group: "other",
    action: { kind: "logout" },
  },
];

function renderHelp(userName?: string): string {
  // Pad command column to a stable width so descriptions align.
  const widths = MENU.map(
    (e) => `[${String(e.num).padStart(2, " ")}]  ${e.command}`.length,
  );
  const maxWidth = Math.max(...widths);
  const lines: string[] = [];
  lines.push("");
  lines.push(`  ${st.bold(`Welcome back, ${userName || "user"}.`)}`);
  lines.push("");
  lines.push(
    `  ${st.dim("Type a command below, or pick one by number and press Enter.")}`,
  );
  lines.push("");
  lines.push(`  ${st.brand("Deliberation modes")}`);
  for (const entry of MENU.filter((e) => e.group === "modes")) {
    const head = `[${String(entry.num).padStart(2, " ")}]  ${entry.command}`;
    const padded = head.padEnd(maxWidth, " ");
    lines.push(`  ${padded}   ${st.dim(entry.description)}`);
  }
  lines.push("");
  lines.push(`  ${st.brand("Other")}`);
  for (const entry of MENU.filter((e) => e.group === "other")) {
    const head = `[${String(entry.num).padStart(2, " ")}]  ${entry.command}`;
    const padded = head.padEnd(maxWidth, " ");
    lines.push(`  ${padded}   ${st.dim(entry.description)}`);
  }
  lines.push("");
  return lines.join("\n");
}

function promptInput(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function executeEntry(entry: MenuEntry): Promise<boolean> {
  const config = loadConfig();
  const webUrl = config.webUrl || DEFAULT_WEB_ORIGIN;

  switch (entry.action.kind) {
    case "debate": {
      const topic = await promptInput(st.brand("Topic: "));
      if (!topic) return true;
      const { debateCommand } = await import("./debate.js");
      await debateCommand(topic, { mode: entry.action.mode });
      return true;
    }
    case "redteam": {
      const content = await promptInput(st.brand("Content to assess: "));
      if (!content) return true;
      const { redteamCommand } = await import("./redteam.js");
      await redteamCommand(content, {});
      return true;
    }
    case "eval": {
      const topic = await promptInput(st.brand("Topic: "));
      if (!topic) return true;
      const { evalCommand } = await import("./eval.js");
      await evalCommand(topic, {});
      return true;
    }
    case "chat": {
      const { chatCommand } = await import("./chat.js");
      await chatCommand();
      return false;
    }
    case "resume": {
      const { SessionManager } = await import("../utils/session-manager.js");
      const sm = new SessionManager();
      const sessions = sm.listSessions();
      if (sessions.length === 0) {
        console.log(st.dim("\n  No saved sessions.\n"));
        return true;
      }
      console.log(st.bold("\n  Saved Sessions:\n"));
      for (let i = 0; i < Math.min(sessions.length, 10); i++) {
        const s = sessions[i];
        if (!s) continue;
        console.log(
          `  ${i + 1}. ${s.name || "Untitled"} (${s.debateCount} debates)`,
        );
        console.log(st.dim(`     ID: ${s.id}\n`));
      }
      console.log(st.dim("  Resume: consilium sessions resume <id>\n"));
      return true;
    }
    case "stats": {
      const { statsCommand } = await import("./stats.js");
      await statsCommand();
      return true;
    }
    case "config": {
      openBrowser(webUrl + "/settings#api-keys");
      console.log(st.success("Opened settings in browser."));
      return true;
    }
    case "logout": {
      const { logoutCommand } = await import("./logout.js");
      logoutCommand();
      return false;
    }
  }
}

function findEntryByInput(input: string): MenuEntry | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Numeric pick.
  const asNum = Number.parseInt(trimmed, 10);
  if (Number.isInteger(asNum)) {
    const hit = MENU.find((e) => e.num === asNum);
    if (hit) return hit;
  }
  // Loose match against the command string ('quick', 'deep', etc.).
  const lower = trimmed.toLowerCase();
  if (lower === "q" || lower === "quit" || lower === "exit") return null;
  return (
    MENU.find((e) => e.command.toLowerCase().includes(` --mode ${lower}`)) ||
    MENU.find(
      (e) =>
        lower.startsWith(e.command.toLowerCase().split(" ")[0]!) &&
        e.action.kind === "chat",
    ) ||
    null
  );
}

export async function menuCommand(): Promise<void> {
  await showMenu();
}

export async function showMenu(): Promise<void> {
  const config = loadConfig();
  process.stdout.write(renderHelp(config.userName));

  // Non-TTY (CI, piped invocation): just print the command list and exit.
  if (!terminal.isTTY) return;

  let running = true;
  while (running) {
    const choice = await promptInput(`  ${st.dim(">")} `);
    if (!choice) {
      running = false;
      break;
    }
    if (choice === "q" || choice === "quit" || choice === "exit") {
      running = false;
      break;
    }
    const entry = findEntryByInput(choice);
    if (!entry) {
      console.log(
        st.warning(
          `  Unknown selection: "${choice}". Type a number 1–${MENU.length}, a mode name, or 'quit'.`,
        ),
      );
      continue;
    }
    console.log("");
    try {
      const shouldContinue = await executeEntry(entry);
      running = shouldContinue;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(st.error(`  Error: ${message}`));
    }
    if (running) {
      // Re-print the menu after an action so the user can chain.
      process.stdout.write(renderHelp(config.userName));
    }
  }
}
