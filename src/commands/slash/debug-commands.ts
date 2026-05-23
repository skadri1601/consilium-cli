import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ChatSession } from "../chat-session";
import { getExtras, type SlashResult } from "./shared-state";
import { style } from "../../utils/visual-system";
import { runDiagnostics, renderDiagnostics } from "../../utils/diagnostics";
import { getTUI } from "../../utils/tui-renderer";

const st = style();

export async function slashDoctor(): Promise<SlashResult> {
  console.log(st.dim("\nRunning diagnostics..."));
  try {
    const result = await runDiagnostics();
    console.log("");
    console.log(renderDiagnostics(result));
    console.log("");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(st.error(`\nDiagnostics failed: ${msg}\n`));
  }
  return "continue";
}

export function slashHeapdump(): SlashResult {
  const dir = path.join(
    process.env.HOME || process.env.USERPROFILE || "",
    ".consilium",
    "diagnostics",
  );
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(st.error(`\nCould not create ${dir}: ${msg}\n`));
    return "continue";
  }
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(dir, `heap-${ts}.json`);
  const report = (
    process as unknown as {
      report?: {
        writeReport?: (filename?: string) => string | undefined;
      };
    }
  ).report;
  if (report && typeof report.writeReport === "function") {
    try {
      const written = report.writeReport(target) ?? target;
      console.log(st.success(`\nHeap diagnostic written: ${written}\n`));
      return "continue";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(
        st.warning(`process.report.writeReport failed (${msg}); falling back.`),
      );
    }
  }
  try {
    const snapshot = {
      timestamp: ts,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      memoryUsage: process.memoryUsage(),
      resourceUsage:
        typeof process.resourceUsage === "function"
          ? process.resourceUsage()
          : null,
      uptimeSeconds: process.uptime(),
    };
    fs.writeFileSync(target, JSON.stringify(snapshot, null, 2));
    console.log(st.success(`\nHeap snapshot fallback written: ${target}\n`));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(st.error(`\nCould not write heap snapshot: ${msg}\n`));
  }
  return "continue";
}

export async function slashInsights(): Promise<SlashResult> {
  console.log(st.dim("Analyzing sessions..."));
  const { analyzeSessions, renderInsights } =
    await import("../../utils/session-analytics.js");
  try {
    const insights = await analyzeSessions({ sinceDays: 30 });
    console.log(renderInsights(insights));
    console.log("");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(st.error(`Insight analysis failed: ${msg}`));
  }
  return "continue";
}

function expandHome(target: string): string {
  if (target.startsWith("~")) return path.join(os.homedir(), target.slice(1));
  return target;
}

export async function slashTeamOnboarding(
  args: string[],
): Promise<SlashResult> {
  const target = args[0] || "~/.consilium/onboarding-guide.md";
  console.log(st.dim("Generating onboarding guide..."));
  const { analyzeSessions, renderOnboardingGuide } =
    await import("../../utils/session-analytics.js");
  try {
    const insights = await analyzeSessions({ sinceDays: 30 });
    const guide = renderOnboardingGuide(insights);
    const outPath = expandHome(target);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, guide, "utf-8");
    console.log(st.success(`Onboarding guide saved to ${outPath}`));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(st.error(`Onboarding generation failed: ${msg}`));
  }
  return "continue";
}

export async function slashMemory(): Promise<SlashResult> {
  const { loadMemory, renderMemoryForPrompt } =
    await import("../../utils/auto-memory.js");
  const mem = loadMemory();
  if (!mem) {
    console.log(st.dim("No memory notes yet for this project."));
    return "continue";
  }
  console.log(renderMemoryForPrompt(mem));
  console.log("");
  return "continue";
}

export function slashTUI(): SlashResult {
  if (!process.stdout.isTTY) {
    console.log(st.warning("Fullscreen mode requires a TTY.\n"));
    return "continue";
  }
  const tui = getTUI();
  if (tui.isActive()) {
    tui.leave();
    console.log(st.dim("Fullscreen mode disabled"));
  } else {
    tui.enter();
    console.log(st.dim("Fullscreen mode enabled. Use /tui again to disable."));
  }
  return "continue";
}

export async function slashUltraPlan(args: string[]): Promise<SlashResult> {
  const topic = args.join(" ").trim();
  if (!topic) {
    console.log(st.warning("Usage: /ultraplan <topic>"));
    return "continue";
  }
  console.log(st.dim("Running multi-agent plan generation..."));
  try {
    const { runUltraPlan } = await import("../../utils/ultraplan.js");
    const result = await runUltraPlan({ topic, save: true });
    console.log(result.markdown);
    if (result.savedTo) {
      console.log(st.success(`\nPlan saved to ${result.savedTo}`));
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(st.error(`UltraPlan failed: ${msg}`));
  }
  return "continue";
}

export async function slashUltraReview(args: string[]): Promise<SlashResult> {
  const branch = args[0];
  console.log(st.dim("Running multi-agent code review..."));
  try {
    const { runUltraReview } = await import("../../utils/ultrareview.js");
    const result = await runUltraReview({ branch });
    console.log(result.markdown);
    if (result.blocked) {
      console.log(st.error("\nReview BLOCKED - address critical issues"));
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(st.error(`UltraReview failed: ${msg}`));
  }
  return "continue";
}

export async function slashCustomCommand(
  cmdName: string,
  args: string[],
  session: ChatSession,
): Promise<{ result: SlashResult; prompt?: string }> {
  const extras = getExtras(session);
  const cmd = extras.customCommands.get(cmdName);
  if (!cmd) {
    return { result: "continue" };
  }
  try {
    const mod = await import("../../utils/custom-commands.js");
    if (typeof mod.executeCustomCommand !== "function") {
      console.log(st.warning("Custom commands runtime not yet available.\n"));
      return { result: "continue" };
    }
    const prompt = mod.executeCustomCommand(cmd, args);
    console.log(
      st.success(`Custom command /${cmdName} resolved.`),
      st.dim("  Sending as user prompt...\n"),
    );
    return { result: "continue", prompt };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(
      st.warning(`Custom command runtime not yet available: ${msg}\n`),
    );
    return { result: "continue" };
  }
}

export async function ensureCustomCommandsLoaded(
  session: ChatSession,
): Promise<void> {
  const extras = getExtras(session);
  if (extras.customCommandsLoaded) return;
  extras.customCommandsLoaded = true;
  try {
    const mod = await import("../../utils/custom-commands.js");
    if (typeof mod.loadCustomCommands !== "function") return;
    const cmds = await mod.loadCustomCommands();
    for (const cmd of cmds) {
      extras.customCommands.set(cmd.name, cmd);
    }
  } catch {}
}

export function printExtendedHelp(session: ChatSession): void {
  const extras = getExtras(session);
  console.log(st.bold("\n  Session control"));
  console.log(
    st.dim("  /checkpoint [name] - Snapshot current session for later /rewind"),
  );
  console.log(
    st.dim(
      "  /rewind [id]    - Restore a snapshot; no id lists available snapshots",
    ),
  );
  console.log(
    st.dim("  /fork [name]    - Clone this session into a new branch"),
  );
  console.log(st.dim("  /usage          - Show session token + cost summary"));
  console.log(st.bold("\n  Autonomy"));
  console.log(
    st.dim("  /loop <min> <prompt>     - Repeat a prompt every N minutes"),
  );
  console.log(
    st.dim(
      "  /schedule <spec> <prompt> - Schedule a prompt (5m, 1h, daily, ...)",
    ),
  );
  console.log(
    st.dim("  /goal <text>    - Set session goal (preamble for future turns)"),
  );
  console.log(st.dim("  /goal clear     - Remove the goal"));
  console.log(st.bold("\n  Planning"));
  console.log(st.dim("  /plan           - Toggle plan mode (writes gated)"));
  console.log(
    st.dim("  /effort <level> - Reasoning depth: low|medium|high|xhigh|max"),
  );
  console.log(st.bold("\n  Diagnostics"));
  console.log(
    st.dim("  /recap          - One-paragraph summary of last 5 debates"),
  );
  console.log(
    st.dim("  /stop           - Cancel the in-flight debate (if any)"),
  );
  console.log(
    st.dim(
      "  /doctor         - System + API + provider key + autonomy + disk usage",
    ),
  );
  console.log(
    st.dim(
      "  /heapdump       - Write a Node diagnostic report to ~/.consilium/diagnostics/",
    ),
  );
  console.log(st.bold("\n  Memory & Analytics"));
  console.log(
    st.dim("  /memory         - Show project memory notes (auto-curated)"),
  );
  console.log(
    st.dim("  /insights       - Analyze recent sessions for friction patterns"),
  );
  console.log(
    st.dim("  /team-onboarding [path] - Generate a shareable onboarding guide"),
  );

  if (extras.customCommands.size > 0) {
    console.log(st.bold("\n  Custom (~/.consilium/commands/*.md)"));
    for (const cmd of extras.customCommands.values()) {
      const desc = cmd.description ? ` - ${cmd.description}` : "";
      console.log(st.dim(`  /${cmd.name}${desc}`));
    }
  }
  console.log("");
}
