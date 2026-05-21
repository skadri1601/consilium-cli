import fs from "node:fs";
import { ConsiliumClient, DeliberationEvent } from "../api/client";
import { requireAuth } from "../utils/require-auth";
import { style } from "../utils/visual-system";
import { terminal } from "../utils/terminal-capabilities";
import { log } from "../utils/logger";
import logUpdate from "log-update";

const st = style();

export interface EvalCommandOptions {
  responses?: string;
  models?: string[];
}

interface EvalStreamCtx {
  useLiveProgress: boolean;
  currentPhase: string;
  votes: Array<{ agent: string; position: string; confidence: number }>;
  costs: Array<{ model: string; tokens: number; cost: number }>;
  resultText: string;
}

function readResponsesJsonFile(
  filePath: string,
): unknown[] | Record<string, unknown> {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object") {
      console.log(
        st.error("Responses file must contain a JSON array or object"),
      );
      process.exit(1);
    }
    return parsed as unknown[] | Record<string, unknown>;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.log(st.error(`Failed to read responses file: ${msg}`));
    process.exit(1);
  }
}

function onEvalPhaseChange(event: DeliberationEvent, ctx: EvalStreamCtx): void {
  ctx.currentPhase = event.phase || "";
  if (ctx.useLiveProgress) {
    logUpdate(st.brand(`  Phase: ${ctx.currentPhase}...`));
    return;
  }
  console.log(st.brand(`  ${ctx.currentPhase}...`));
}

function onEvalModelProgress(
  event: DeliberationEvent,
  ctx: EvalStreamCtx,
): void {
  if (!ctx.useLiveProgress) return;
  if (event.agent === undefined || event.progress === undefined) return;
  const pct = Math.round(event.progress);
  logUpdate(
    st.brand(`  Phase: ${ctx.currentPhase}...`) + `\n  ${event.agent}: ${pct}%`,
  );
}

function onEvalVote(event: DeliberationEvent, ctx: EvalStreamCtx): void {
  if (!event.vote) return;
  ctx.votes.push(event.vote);
  if (ctx.useLiveProgress) return;
  console.log(
    st.dim(
      `  Vote: ${event.vote.agent} -> ${event.vote.position} (${Math.round(event.vote.confidence * 100)}%)`,
    ),
  );
}

function onEvalCost(event: DeliberationEvent, ctx: EvalStreamCtx): void {
  if (event.cost) {
    ctx.costs.push(event.cost);
  }
}

function onEvalComplete(event: DeliberationEvent, ctx: EvalStreamCtx): void {
  if (event.text) {
    ctx.resultText = event.text;
  }
  if (ctx.useLiveProgress) logUpdate.clear();
}

function onEvalError(event: DeliberationEvent, ctx: EvalStreamCtx): void {
  if (ctx.useLiveProgress) logUpdate.clear();
  throw new Error(event.error || "Evaluation error");
}

function processEvalEvent(event: DeliberationEvent, ctx: EvalStreamCtx): void {
  if (event.type === "phase_change") {
    onEvalPhaseChange(event, ctx);
    return;
  }
  if (event.type === "model_progress") {
    onEvalModelProgress(event, ctx);
    return;
  }
  if (event.type === "vote_cast") {
    onEvalVote(event, ctx);
    return;
  }
  if (event.type === "cost_update") {
    onEvalCost(event, ctx);
    return;
  }
  if (event.type === "deliberation_complete") {
    onEvalComplete(event, ctx);
    return;
  }
  if (event.type === "error") {
    onEvalError(event, ctx);
  }
}

function printEvalSummary(ctx: EvalStreamCtx): void {
  if (ctx.votes.length > 0) {
    console.log(st.dim("\n  Evaluation votes:"));
    for (const v of ctx.votes) {
      console.log(
        st.dim(
          `    ${v.agent}: ${v.position} (${Math.round(v.confidence * 100)}% confidence)`,
        ),
      );
    }
  }

  if (ctx.resultText) {
    console.log("\n" + ctx.resultText);
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

  console.log(st.success("\nBlind evaluation complete.\n"));
}

export async function evalCommand(
  topic: string,
  options: EvalCommandOptions,
): Promise<void> {
  await requireAuth();

  const responsesPayload = options.responses
    ? readResponsesJsonFile(options.responses)
    : undefined;

  const models = options.models ?? [
    "gpt-4o-mini",
    "claude-haiku-4-5-20251001",
    "gemini-2.0-flash",
  ];
  const client = new ConsiliumClient();
  const useLiveProgress = terminal.isTTY && !terminal.usePlain;
  const startTime = Date.now();

  console.log(st.brand("\n  Blind Evaluation\n"));

  const isHealthy = await client.healthCheck();
  if (!isHealthy) {
    console.log(st.error("API is not available"));
    process.exit(1);
  }

  let debate: { id: string };
  try {
    const body: Record<string, unknown> = {
      topic,
      models,
      mode: "blind",
      debateSource: "cli",
    };
    if (responsesPayload) body.responses = responsesPayload;
    debate = await client.createDebate(body as any);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Create failed";
    log("ERROR", "eval_failed", { error: msg });
    console.log(st.error("Evaluation creation failed: " + msg));
    process.exit(1);
  }

  log("INFO", "eval_started", { debateId: debate.id });

  const ctx: EvalStreamCtx = {
    useLiveProgress,
    currentPhase: "",
    votes: [],
    costs: [],
    resultText: "",
  };

  try {
    await client.streamDebate(debate.id, (event) => {
      processEvalEvent(event as DeliberationEvent, ctx);
    });
  } catch (error: unknown) {
    if (useLiveProgress) logUpdate.clear();
    const msg = error instanceof Error ? error.message : "Unknown error";
    log("ERROR", "eval_failed", {
      debateId: debate.id,
      error: msg,
      durationMs: Date.now() - startTime,
    });
    console.log(st.error("\n  Error: " + msg + "\n"));
    process.exit(1);
  }

  log("INFO", "eval_completed", {
    debateId: debate.id,
    durationMs: Date.now() - startTime,
  });

  printEvalSummary(ctx);
}
