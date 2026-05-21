import { ConsiliumClient, DeliberationEvent } from "../api/client";
import { requireAuth } from "../utils/require-auth";
import { style } from "../utils/visual-system";
import { terminal } from "../utils/terminal-capabilities";
import { log } from "../utils/logger";
import logUpdate from "log-update";

const st = style();

export interface RedTeamCommandOptions {
  models?: string[];
  categories?: string[];
}

interface RedTeamStreamCtx {
  useLiveProgress: boolean;
  currentPhase: string;
  findings: string[];
  costs: Array<{ model: string; tokens: number; cost: number }>;
  resultText: string;
}

function onRedteamPhaseChange(
  event: DeliberationEvent,
  ctx: RedTeamStreamCtx,
): void {
  ctx.currentPhase = event.phase || "";
  if (ctx.useLiveProgress) {
    logUpdate(st.brand(`  Phase: ${ctx.currentPhase}...`));
    return;
  }
  console.log(st.brand(`  ${ctx.currentPhase}...`));
}

function onRedteamModelProgress(
  event: DeliberationEvent,
  ctx: RedTeamStreamCtx,
): void {
  if (!ctx.useLiveProgress) return;
  if (event.agent === undefined || event.progress === undefined) return;
  const pct = Math.round(event.progress);
  logUpdate(
    st.brand(`  Phase: ${ctx.currentPhase}...`) + `\n  ${event.agent}: ${pct}%`,
  );
}

function onRedteamDissent(
  event: DeliberationEvent,
  ctx: RedTeamStreamCtx,
): void {
  if (!event.dissent) return;
  ctx.findings.push(`${event.dissent.agent}: ${event.dissent.reason}`);
  if (ctx.useLiveProgress) return;
  console.log(
    st.warning(`  Finding: ${event.dissent.agent} - ${event.dissent.reason}`),
  );
}

function onRedteamCost(event: DeliberationEvent, ctx: RedTeamStreamCtx): void {
  if (event.cost) {
    ctx.costs.push(event.cost);
  }
}

function onRedteamComplete(
  event: DeliberationEvent,
  ctx: RedTeamStreamCtx,
): void {
  if (event.text) {
    ctx.resultText = event.text;
  }
  if (ctx.useLiveProgress) logUpdate.clear();
}

function onRedteamError(event: DeliberationEvent, ctx: RedTeamStreamCtx): void {
  if (ctx.useLiveProgress) logUpdate.clear();
  throw new Error(event.error || "Red team error");
}

function processRedteamEvent(
  event: DeliberationEvent,
  ctx: RedTeamStreamCtx,
): void {
  if (event.type === "phase_change") {
    onRedteamPhaseChange(event, ctx);
    return;
  }
  if (event.type === "model_progress") {
    onRedteamModelProgress(event, ctx);
    return;
  }
  if (event.type === "dissent_detected") {
    onRedteamDissent(event, ctx);
    return;
  }
  if (event.type === "cost_update") {
    onRedteamCost(event, ctx);
    return;
  }
  if (event.type === "deliberation_complete") {
    onRedteamComplete(event, ctx);
    return;
  }
  if (event.type === "error") {
    onRedteamError(event, ctx);
  }
}

function printRedteamSummary(ctx: RedTeamStreamCtx): void {
  if (ctx.resultText) {
    console.log("\n" + ctx.resultText);
  }

  if (ctx.findings.length > 0) {
    console.log(st.warning(`\n  ${ctx.findings.length} finding(s) detected`));
  }

  if (ctx.costs.length > 0) {
    console.log(st.dim("\n  Cost breakdown:"));
    let total = 0;
    for (const c of ctx.costs) {
      total += c.cost;
      console.log(
        st.dim(
          `    ${c.model.padEnd(28)} ${c.tokens.toLocaleString()} tokens  $${c.cost.toFixed(4)}`,
        ),
      );
    }
    console.log(st.dim(`    ${"Total".padEnd(28)} $${total.toFixed(4)}`));
  }

  console.log(st.success("\nRed team assessment complete.\n"));
}

export async function redteamCommand(
  content: string,
  options: RedTeamCommandOptions,
): Promise<void> {
  await requireAuth();

  const client = new ConsiliumClient();
  const useLiveProgress = terminal.isTTY && !terminal.usePlain;
  const startTime = Date.now();

  console.log(st.brand("\n  Red Team Assessment\n"));

  const isHealthy = await client.healthCheck();
  if (!isHealthy) {
    console.log(st.error("API is not available"));
    process.exit(1);
  }

  const models = options.models || [
    "gpt-4o-mini",
    "claude-haiku-4-5-20251001",
    "gemini-2.0-flash",
  ];
  let assessment: { id: string };
  try {
    assessment = await client.createDebate({
      topic: content,
      models,
      mode: "redteam",
      debateSource: "cli",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Create failed";
    log("ERROR", "redteam_failed", { error: msg });
    console.log(st.error("Red team creation failed: " + msg));
    process.exit(1);
  }

  log("INFO", "redteam_started", { debateId: assessment.id });

  const ctx: RedTeamStreamCtx = {
    useLiveProgress,
    currentPhase: "",
    findings: [],
    costs: [],
    resultText: "",
  };

  try {
    await client.streamDebate(assessment.id, (event) => {
      processRedteamEvent(event as DeliberationEvent, ctx);
    });
  } catch (error: unknown) {
    if (useLiveProgress) logUpdate.clear();
    const msg = error instanceof Error ? error.message : "Unknown error";
    log("ERROR", "redteam_failed", {
      debateId: assessment.id,
      error: msg,
      durationMs: Date.now() - startTime,
    });
    console.log(st.error("\n  Error: " + msg + "\n"));
    process.exit(1);
  }

  log("INFO", "redteam_completed", {
    debateId: assessment.id,
    durationMs: Date.now() - startTime,
  });

  printRedteamSummary(ctx);
}
