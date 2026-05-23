import type { ChatSession } from "../chat-session";
import {
  getExtras,
  parseDurationToMs,
  makeLocalId,
  formatDurationMs,
  type SlashResult,
} from "./shared-state";
import { style } from "../../utils/visual-system";
import {
  clearGoal,
  persistGoal,
  persistLoop,
  persistSchedule,
  updateLoopLastRun,
  updateScheduleNextRun,
} from "../../utils/autonomy-store";

const st = style();

export function slashLoop(args: string[], session: ChatSession): SlashResult {
  if (args.length < 2) {
    console.log(st.warning("Usage: /loop <minutes> <prompt>"));
    console.log(
      st.dim("  Examples: /loop 5 check the deploy, /loop 30m run tests\n"),
    );
    return "continue";
  }
  const durationToken = args[0] ?? "";
  const promptText = args.slice(1).join(" ").trim();
  if (!promptText) {
    console.log(st.warning("Loop prompt is required.\n"));
    return "continue";
  }
  const numeric = /^\d+(\.\d+)?$/.test(durationToken)
    ? `${durationToken}m`
    : durationToken;
  const intervalMs = parseDurationToMs(numeric);
  if (!intervalMs || intervalMs < 1000) {
    console.log(
      st.warning(
        "Invalid interval. Use minutes (e.g. 5) or 30m, 1h, 2h, 1d.\n",
      ),
    );
    return "continue";
  }

  const extras = getExtras(session);
  const id = makeLocalId("loop");
  const sessionId = session.id ?? "__pending__";
  const timer = setInterval(() => {
    console.log(st.dim(`\n[loop ${id}] tick - prompt queued: ${promptText}\n`));
    try {
      updateLoopLastRun(sessionId, id, Date.now());
    } catch {
      // best-effort metadata refresh
    }
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  extras.loops.set(id, { id, intervalMs, prompt: promptText, timer });

  try {
    persistLoop({
      id,
      sessionId,
      intervalMs,
      prompt: promptText,
      createdAt: Date.now(),
    });
  } catch {
    // best-effort persistence; loop still runs in-process
  }

  console.log(
    st.success(
      `Loop registered (${id}). Will run every ${formatDurationMs(intervalMs)}.`,
    ),
  );
  console.log(
    st.dim(
      "  Loops persist across /exit and resume on next chat for this session.\n",
    ),
  );
  return "continue";
}

export function slashGoal(args: string[], session: ChatSession): SlashResult {
  const extras = getExtras(session);
  const sessionId = session.id ?? "__pending__";
  const sub = args[0]?.toLowerCase();
  if (!args.length) {
    if (extras.goal) {
      console.log(st.bold("\nSession goal\n"));
      console.log(st.brand("Working toward:"), extras.goal);
      console.log(st.dim("\nUse /goal clear to remove.\n"));
    } else {
      console.log(st.dim("\nNo goal set. Usage: /goal <text>\n"));
    }
    return "continue";
  }
  if (sub === "clear" || sub === "reset" || sub === "remove") {
    extras.goal = undefined;
    try {
      clearGoal(sessionId);
    } catch {
      // best-effort
    }
    console.log(st.success("Session goal cleared.\n"));
    return "continue";
  }
  const text = args.join(" ").trim();
  if (!text) {
    console.log(st.warning("Goal text is required.\n"));
    return "continue";
  }
  extras.goal = text;
  try {
    persistGoal({ sessionId, text, setAt: Date.now() });
  } catch {
    // best-effort persistence
  }
  console.log(
    st.success("Session goal set."),
    st.dim('  Future turns will include: "Working toward: ..."\n'),
  );
  return "continue";
}

export function slashSchedule(
  args: string[],
  session: ChatSession,
): SlashResult {
  if (args.length < 2) {
    console.log(st.warning("Usage: /schedule <interval> <prompt>"));
    console.log(
      st.dim("  Examples: /schedule 5m check status, /schedule daily digest\n"),
    );
    return "continue";
  }
  const spec = args[0] ?? "";
  const promptText = args.slice(1).join(" ").trim();
  if (!promptText) {
    console.log(st.warning("Scheduled prompt is required.\n"));
    return "continue";
  }
  const intervalMs = parseDurationToMs(spec);
  if (!intervalMs || intervalMs < 1000) {
    console.log(
      st.warning("Invalid interval. Use 5m, 30m, 1h, daily, hourly, etc.\n"),
    );
    return "continue";
  }

  const extras = getExtras(session);
  const id = makeLocalId("sched");
  const sessionId = session.id ?? "__pending__";
  const createdAt = Date.now();
  const timer = setInterval(() => {
    console.log(
      st.dim(`\n[schedule ${id}] tick - prompt queued: ${promptText}\n`),
    );
    try {
      updateScheduleNextRun(sessionId, id, Date.now() + intervalMs, Date.now());
    } catch {
      // best-effort metadata refresh
    }
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  extras.schedules.set(id, {
    id,
    prompt: promptText,
    spec,
    intervalMs,
    timer,
  });

  try {
    persistSchedule({
      id,
      sessionId,
      spec,
      intervalMs,
      nextRunAt: createdAt + intervalMs,
      prompt: promptText,
      createdAt,
    });
  } catch {
    // best-effort persistence; loop still runs in-process
  }

  console.log(
    st.success(`Scheduled (${id}).`),
    st.dim(
      `  Will run every ${formatDurationMs(intervalMs)} (persists across /exit).\n`,
    ),
  );
  return "continue";
}

export async function slashPlan(): Promise<SlashResult> {
  try {
    const mod = await import("../../utils/plan-mode.js");
    if (
      typeof mod.isPlanModeActive !== "function" ||
      typeof mod.enterPlanMode !== "function" ||
      typeof mod.exitPlanMode !== "function"
    ) {
      console.log(st.warning("Plan mode not yet available.\n"));
      return "continue";
    }
    if (mod.isPlanModeActive()) {
      mod.exitPlanMode();
      console.log(st.success("Plan mode: off"));
      console.log(st.dim("  Writes unblocked.\n"));
    } else {
      mod.enterPlanMode();
      console.log(st.success("Plan mode: on"));
      console.log(
        st.dim(
          "  Steps will be recorded; writes are gated on plan approval.\n",
        ),
      );
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(st.warning(`Plan mode not yet available: ${msg}\n`));
  }
  return "continue";
}

export function slashEffort(args: string[], session: ChatSession): SlashResult {
  const valid = ["low", "medium", "high", "xhigh", "max"] as const;
  const extras = getExtras(session);
  const level = args[0]?.toLowerCase() as (typeof valid)[number] | undefined;
  if (!level) {
    const current = extras.reasoningEffort ?? "(default)";
    console.log(st.bold("\nReasoning effort\n"));
    console.log(st.brand("Current:"), current);
    console.log(st.dim(`  Options: ${valid.join(", ")}\n`));
    return "continue";
  }
  if (!(valid as readonly string[]).includes(level)) {
    console.log(
      st.warning(`Invalid effort. Choose from: ${valid.join(", ")}\n`),
    );
    return "continue";
  }
  extras.reasoningEffort = level;
  console.log(
    st.success(`Reasoning effort set: ${level}`),
    st.dim("  Will be sent on subsequent debates when wired upstream.\n"),
  );
  return "continue";
}

export function slashUsage(session: ChatSession): SlashResult {
  const debates = session.debates || [];
  const totalDebates = debates.length;
  const synthChars = debates.reduce(
    (acc, d) => acc + (d.goldenPrompt?.length ?? 0),
    0,
  );
  const topicChars = debates.reduce(
    (acc, d) => acc + (d.topic?.length ?? 0),
    0,
  );
  const approxTokens = Math.ceil((synthChars + topicChars) / 4);

  console.log(st.bold("\nSession usage\n"));
  console.log(st.brand("Debates this session:"), totalDebates);
  console.log(
    st.brand("Approx tokens (chars/4):"),
    approxTokens.toLocaleString(),
  );
  console.log(
    st.dim("  Note: token + cost totals come from cost_update SSE events;"),
  );
  console.log(
    st.dim(
      "  per-debate breakdown is available in the web dashboard (/insights).\n",
    ),
  );
  return "continue";
}
