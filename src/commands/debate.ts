import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import logUpdate from "log-update";
import {
  ConsiliumClient,
  DebateEvent,
  DebateOptions,
  DeliberationEvent,
} from "../api/client";
import {
  ALL_MODES,
  type DebateMode,
  createStepTracker,
  createStreamHandlers,
  estimateCost,
  formatCostEstimate,
  formatOutput,
  getDefaultFilename,
  getDefaultMode,
  isValidMode,
  isValidOutputFormat,
  loadWorkspaceDebateContext,
  log,
  type OutputFormat,
  requireAuth,
  style,
  terminal,
  type WorkspaceDebateContext,
} from "../utils";
import { applyEdits, parseEditsFromSynthesis } from "../utils/apply-edits";
import { formatEditPreview } from "../utils/diff-preview";
import {
  generateImage,
  ImageGenError,
  type ImageSize,
} from "../utils/image-gen-client";
import {
  consumeWritePermission,
  requestWritePermission,
} from "../utils/codebase-permissions";
import { resolveProjectRoot } from "../utils/project-root";
import { KeyManager } from "../utils/key-manager";
import { getPreferences } from "../utils/config";
import { appendProjectMemory } from "../utils/project-memory";
import {
  startToolBridge,
  type ToolBridgeHandle,
} from "../utils/mcp-tool-bridge";
import {
  clearPlan,
  enterPlanMode,
  exitPlanMode,
  getPlan,
  isPlanModeActive,
  promptApproval,
  recordPlanStep,
  renderPlan,
} from "../utils/plan-mode";
import { createWorktree } from "../utils/worktree";
import { isSandboxAvailable } from "../utils/sandbox-stub";
import { detectSandboxCapabilities } from "../utils/sandbox-native";
import {
  emitFinalJson,
  emitStreamEvent,
  isHeadlessFormat,
  isValidOutputFormatFlag,
  type OutputFormat as HeadlessOutputFormat,
  validateAgainstSchema,
} from "../utils/output-formats";
import { BudgetGuard } from "../utils/budget-guard";
import { spawnDetached } from "../utils/agent-supervisor";

const st = style();

function writeDebateMemory(
  wsContext: WorkspaceDebateContext | null | undefined,
  topic: string,
  mode: string,
  resultText: string | undefined,
  debateId: string,
): void {
  if (!wsContext || !resultText) return;
  try {
    appendProjectMemory(wsContext.rootPath, {
      topic,
      mode,
      summary: resultText,
      debateId,
    });
  } catch (err) {
    log("WARN", "memory_write_failed", { error: (err as Error).message });
  }
}

export interface DebateCommandOptions {
  models?: string[];
  output?: string;
  mode?: string;
  scan?: boolean;
  /** Legacy alias for the new default-on git context. Kept for back-compat. */
  gitDiff?: boolean;
  /** Commander negation: present and false when --no-git is passed. Default ON. */
  git?: boolean;
  ticket?: string;
  context?: boolean;
  apply?: boolean;
  file?: string[];
  /** Commander negation: present and false when --no-tools is passed. Default ON. */
  tools?: boolean;
  /** Plan mode: read-only deliberation that prints a plan + asks for approval. */
  plan?: boolean;
  /** Output format for headless / scripting use: text | json | stream-json. */
  outputFormat?: string;
  /** Path to a JSON Schema file. Final synthesis is validated against it. */
  jsonSchema?: string;
  /** Abort the debate if the running cost estimate exceeds this many USD. */
  maxBudgetUsd?: string;
  /** Cap the debate at N rounds (overrides mode default). */
  maxTurns?: string;
  worktree?: string | boolean;
  sandbox?: boolean;
  /** When set with --sandbox, do NOT abort if the native sandbox is unavailable. */
  noSandboxStrict?: boolean;
  /** Run as a detached background agent and exit immediately. */
  bg?: boolean;
  /** Generate an illustration from the final synthesis. */
  generateImage?: boolean;
  /** Source of the image prompt: 'synthesis' (default) or 'topic'. */
  imagePromptFrom?: string;
  /** Image size, e.g. 1024x1024. */
  imageSize?: string;
}

const VALID_IMAGE_SIZES: ReadonlySet<ImageSize> = new Set<ImageSize>([
  "256x256",
  "512x512",
  "1024x1024",
  "1792x1024",
  "1024x1792",
]);

function isValidImageSize(value: string): value is ImageSize {
  return VALID_IMAGE_SIZES.has(value as ImageSize);
}

function buildImagePrompt(
  source: string,
  topic: string,
  synthesis: string,
): string {
  if (source === "topic") {
    return `Render an illustration of: ${topic.trim()}`;
  }
  const text = (synthesis || topic).trim().replace(/\s+/g, " ");
  const truncated = text.length > 500 ? text.slice(0, 500) : text;
  return `Illustrate the key idea of: ${truncated}`;
}

async function maybeGenerateDebateImage(
  options: DebateCommandOptions,
  topic: string,
  synthesis: string,
): Promise<void> {
  if (!options.generateImage) return;
  const source = (options.imagePromptFrom ?? "synthesis").toLowerCase();
  const size = options.imageSize ?? "1024x1024";
  const prompt = buildImagePrompt(source, topic, synthesis);
  if (!prompt.trim()) {
    console.log(st.warning("No content available to build image prompt."));
    return;
  }
  if (!isValidImageSize(size)) {
    console.log(
      st.warning(`Invalid --image-size "${size}". Falling back to 1024x1024.`),
    );
  }
  const resolvedSize: ImageSize = isValidImageSize(size) ? size : "1024x1024";
  console.log(st.dim("\n  Generating image..."));
  try {
    const result = await generateImage({
      prompt,
      size: resolvedSize,
    });
    console.log(st.success(`  Image saved: ${result.filePath}`));
    if (result.revisedPrompt) {
      console.log(st.dim(`  Revised prompt: ${result.revisedPrompt}`));
    }
    if (typeof result.costUsd === "number") {
      console.log(st.dim(`  Image cost: $${result.costUsd.toFixed(4)}`));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const providerLabel =
      err instanceof ImageGenError ? ` [${err.provider}]` : "";
    console.log(
      st.warning(`  Image generation failed${providerLabel}: ${msg}`),
    );
  }
}

function parsePositiveNumber(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

function resolveHeadlessFormat(raw: string | undefined): HeadlessOutputFormat {
  if (raw && isValidOutputFormatFlag(raw)) return raw;
  return "text";
}

const STEP_LABELS: Record<string, string> = {
  health: "Health check",
  createDebate: "Creating debate session",
  startStream: "Establishing event stream",
};

const PHASE_LABELS: Record<string, string> = {
  proposing: "Proposing",
  challenging: "Challenging",
  rebutting: "Rebutting",
  evaluating: "Evaluating",
  voting: "Voting",
  synthesizing: "Synthesizing",
};

function renderPhaseDisplay(
  phase: string,
  modelProgress: Map<string, number>,
  convergence: number | null,
  dissents: Array<{ agent: string; reason: string }>,
): string {
  const lines: string[] = [];

  const phaseLabel = PHASE_LABELS[phase] || phase;
  lines.push(st.brand(`  Phase: ${phaseLabel}...`), "");

  for (const [model, progress] of modelProgress) {
    const filled = Math.round((20 * Math.min(100, progress)) / 100);
    const bar = "\u2588".repeat(filled) + "\u2591".repeat(20 - filled);
    const pct = `${Math.round(progress)}%`;
    const name =
      model.length > 24 ? model.slice(0, 21) + "..." : model.padEnd(24);
    lines.push(`  ${name} [${bar}] ${pct}`);
  }

  if (convergence !== null) {
    lines.push("");
    const cvgPct = Math.round(convergence * 100);
    lines.push(st.dim(`  Convergence: ${cvgPct}%`));
  }

  if (dissents.length > 0) {
    lines.push("", st.warning("  Dissent detected:"));
    for (const d of dissents) {
      lines.push(st.warning(`    ${d.agent}: ${d.reason}`));
    }
  }

  return lines.join("\n");
}

function renderCostBreakdown(
  costs: Array<{ model: string; tokens: number; cost: number }>,
): string {
  if (costs.length === 0) return "";
  const lines: string[] = ["", st.dim("  Cost breakdown:")];
  let total = 0;
  for (const c of costs) {
    total += c.cost;
    lines.push(
      st.dim(
        `    ${c.model.padEnd(28)} ${c.tokens.toLocaleString()} tokens  $${c.cost.toFixed(4)}`,
      ),
    );
  }
  lines.push(st.dim(`    ${"Total".padEnd(28)} $${total.toFixed(4)}`));
  return lines.join("\n");
}

interface DeliberationStreamCtx {
  deliberationId: string;
  useLiveProgress: boolean;
  currentPhase: string;
  modelProgress: Map<string, number>;
  convergence: number | null;
  dissents: Array<{ agent: string; reason: string }>;
  votes: Array<{ agent: string; position: string; confidence: number }>;
  costs: Array<{ model: string; tokens: number; cost: number }>;
  resultText: string;
}

function onDeliberationStreamStart(ctx: DeliberationStreamCtx): void {
  if (ctx.useLiveProgress) return;
  console.log(st.dim(`  Deliberation ${ctx.deliberationId} started`));
}

function onDeliberationPhaseChange(
  event: DeliberationEvent,
  ctx: DeliberationStreamCtx,
): void {
  ctx.currentPhase = event.phase || "";
  ctx.modelProgress.clear();
  if (ctx.useLiveProgress) {
    logUpdate(
      renderPhaseDisplay(
        ctx.currentPhase,
        ctx.modelProgress,
        ctx.convergence,
        ctx.dissents,
      ),
    );
    return;
  }
  const label = PHASE_LABELS[ctx.currentPhase] || ctx.currentPhase;
  console.log(st.brand(`\n  ${label}...`));
}

function onDeliberationModelProgress(
  event: DeliberationEvent,
  ctx: DeliberationStreamCtx,
): void {
  if (event.agent !== undefined && event.progress !== undefined) {
    ctx.modelProgress.set(event.agent, event.progress);
  }
  if (ctx.useLiveProgress) {
    logUpdate(
      renderPhaseDisplay(
        ctx.currentPhase,
        ctx.modelProgress,
        ctx.convergence,
        ctx.dissents,
      ),
    );
  }
}

function onDeliberationConvergence(
  event: DeliberationEvent,
  ctx: DeliberationStreamCtx,
): void {
  if (event.convergence !== undefined) {
    ctx.convergence = event.convergence;
  }
  if (ctx.useLiveProgress) {
    logUpdate(
      renderPhaseDisplay(
        ctx.currentPhase,
        ctx.modelProgress,
        ctx.convergence,
        ctx.dissents,
      ),
    );
    return;
  }
  const cvg = Math.round((ctx.convergence ?? 0) * 100);
  console.log(st.dim(`  Convergence: ${cvg}%`));
}

function onDeliberationDissent(
  event: DeliberationEvent,
  ctx: DeliberationStreamCtx,
): void {
  if (!event.dissent) return;
  ctx.dissents.push(event.dissent);
  if (ctx.useLiveProgress) return;
  console.log(
    st.warning(`  Dissent: ${event.dissent.agent} - ${event.dissent.reason}`),
  );
}

function onDeliberationVote(
  event: DeliberationEvent,
  ctx: DeliberationStreamCtx,
): void {
  if (!event.vote) return;
  ctx.votes.push(event.vote);
  if (ctx.useLiveProgress) return;
  console.log(
    st.dim(
      `  Vote: ${event.vote.agent} -> ${event.vote.position} (${Math.round(event.vote.confidence * 100)}%)`,
    ),
  );
}

function onDeliberationCost(
  event: DeliberationEvent,
  ctx: DeliberationStreamCtx,
): void {
  if (event.cost) {
    ctx.costs.push(event.cost);
  }
}

function onDeliberationComplete(
  event: DeliberationEvent,
  ctx: DeliberationStreamCtx,
): void {
  if (event.text) {
    ctx.resultText = event.text;
  }
  if (ctx.useLiveProgress) logUpdate.clear();
}

function onDeliberationError(
  event: DeliberationEvent,
  ctx: DeliberationStreamCtx,
): void {
  if (ctx.useLiveProgress) logUpdate.clear();
  throw new Error(event.error || "Deliberation error");
}

function onRoutingFallback(
  event: DeliberationEvent,
  ctx: DeliberationStreamCtx,
): void {
  if (ctx.useLiveProgress) logUpdate.clear();
  const count = event.resolutions?.length ?? 0;
  console.log(
    st.warning(
      `\n  Using Consilium free tier for ${count} model(s). ` +
        "Set your own provider API key(s) to use the originally requested models.",
    ),
  );
  for (const r of event.resolutions || []) {
    console.log(
      st.dim(
        `    ${r.requested_model} -> ${r.effective_provider}:${r.effective_model}` +
          (r.fallback_reason ? `  (${r.fallback_reason})` : ""),
      ),
    );
  }
  console.log("");
}

function processDeliberationEvent(
  event: DeliberationEvent,
  ctx: DeliberationStreamCtx,
): void {
  if (event.type === "routing:fallback") {
    onRoutingFallback(event, ctx);
    return;
  }
  if (event.type === "deliberation_start") {
    onDeliberationStreamStart(ctx);
    return;
  }
  if (event.type === "phase_change") {
    onDeliberationPhaseChange(event, ctx);
    return;
  }
  if (event.type === "model_progress") {
    onDeliberationModelProgress(event, ctx);
    return;
  }
  if (event.type === "convergence_update") {
    onDeliberationConvergence(event, ctx);
    return;
  }
  if (event.type === "dissent_detected") {
    onDeliberationDissent(event, ctx);
    return;
  }
  if (event.type === "vote_cast") {
    onDeliberationVote(event, ctx);
    return;
  }
  if (event.type === "cost_update") {
    onDeliberationCost(event, ctx);
    return;
  }
  if (event.type === "deliberation_complete") {
    onDeliberationComplete(event, ctx);
    return;
  }
  if (event.type === "error") {
    onDeliberationError(event, ctx);
  }
}

function warnDebateCommandOptions(
  options: DebateCommandOptions,
  mode: DebateMode,
  outputFormat: OutputFormat,
): void {
  if (options.mode && !isValidMode(options.mode)) {
    console.log(
      st.warning(
        `Invalid mode "${options.mode}". Using "${mode}". Valid: ${ALL_MODES.join(", ")}`,
      ),
    );
  }
  if (options.output && !isValidOutputFormat(options.output)) {
    console.log(
      st.warning(
        `Invalid output format "${options.output}". Using terminal output. Valid: markdown, cursorrules, claude-md, json`,
      ),
    );
  }
}

function logStreamFailureHints(error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status?: number }).status
      : error && typeof error === "object" && "httpStatus" in error
        ? (error as { httpStatus?: number }).httpStatus
        : undefined;

  if (msg.includes("ECONNREFUSED")) {
    console.log(st.warning("Make sure the Consilium backend is running."));
    console.log(st.dim("Try: docker-compose up\n"));
    return;
  }
  if (status === 401 || status === 403) {
    console.log(
      st.warning(
        "Authentication failed. Run consilium login or configure your API key:",
      ),
    );
    console.log(st.dim('consilium config set apiKey "your-key"\n'));
    return;
  }
  if (status === 404) {
    console.log(
      st.warning(
        "Debate not found. It may have been deleted or the ID is wrong.\n",
      ),
    );
    return;
  }
  if (msg.includes("timeout") || msg.includes("Timeout")) {
    console.log(
      st.warning(
        "Request timed out. Increase timeout with CONSILIUM_STREAM_TIMEOUT env var.",
      ),
    );
    console.log(
      st.dim(
        'Example: CONSILIUM_STREAM_TIMEOUT=600000 consilium debate "topic"\n',
      ),
    );
  }
}

function writeFormattedDebateOutput(
  goldenPrompt: string,
  outputFormat: OutputFormat,
  topic: string,
  models: string[],
  mode: DebateMode,
  debateId: string,
): void {
  if (!goldenPrompt || outputFormat === "text") return;
  const formatted = formatOutput(goldenPrompt, {
    format: outputFormat,
    topic,
    models,
    mode,
    debateId,
    timestamp: new Date().toISOString(),
  });
  if (outputFormat === "cursorrules" || outputFormat === "claude-md") {
    const filename = getDefaultFilename(outputFormat, topic);
    fs.writeFileSync(filename, formatted, "utf-8");
    console.log(st.success(`Saved to ${filename}`));
    return;
  }
  if (outputFormat === "json" || outputFormat === "markdown") {
    console.log(formatted);
  }
}

interface ClassicDebateFlowOptions {
  tools?: boolean;
  wsContext?: WorkspaceDebateContext | null;
  headlessFormat?: HeadlessOutputFormat;
  budgetGuard?: BudgetGuard;
}

async function runClassicDebateFlow(
  client: ConsiliumClient,
  topic: string,
  mode: DebateMode,
  models: string[],
  outputFormat: OutputFormat,
  useLiveProgress: boolean,
  options?: ClassicDebateFlowOptions,
): Promise<string> {
  const wsContext = options?.wsContext;
  const headlessFormat = options?.headlessFormat ?? "text";
  const headless = isHeadlessFormat(headlessFormat);
  const streamJson = headlessFormat === "stream-json";
  const budgetGuard = options?.budgetGuard;
  const liveProgress = useLiveProgress && !headless;
  const stepIds: string[] = ["health", "createDebate", "startStream"];
  const tracker = createStepTracker(stepIds, STEP_LABELS);

  const renderProgress = () => {
    if (liveProgress) {
      logUpdate(tracker.render("Initializing"));
    }
  };

  tracker.start("health");
  renderProgress();
  const isHealthy = await client.healthCheck();

  if (!isHealthy) {
    if (liveProgress) logUpdate.clear();
    if (headless) {
      emitFinalJson({
        ok: false,
        error: "API is not available",
        topic,
        mode,
        models,
      });
    } else {
      console.log(st.error("API is not available"));
    }
    process.exit(1);
  }

  tracker.complete("health");
  tracker.start("createDebate");
  renderProgress();

  const toolsEnabled = options?.tools !== false;
  let bridge: ToolBridgeHandle | null = null;
  if (toolsEnabled) {
    try {
      bridge = await startToolBridge(client, {
        enabled: true,
        quiet: headless,
      });
    } catch (err) {
      if (!headless) {
        console.log(
          st.warning(
            `  Could not start tool bridge: ${(err as Error).message}`,
          ),
        );
        console.log(st.dim("  Continuing without agent file tools."));
      }
    }
  }

  const debateStartTime = Date.now();
  let debate: { id: string };
  try {
    const contextParts = [
      wsContext?.memoryPrefix,
      wsContext?.ticketPrefix,
      wsContext?.gitContextPrefix,
    ]
      .filter(Boolean)
      .join("");
    const effectiveTopic = contextParts ? contextParts + topic : topic;
    const debateOpts: DebateOptions = {
      topic: effectiveTopic,
      models,
      mode,
      debateSource: "cli",
    };
    if (wsContext) {
      debateOpts.files = wsContext.files;
      debateOpts.projectFiles = wsContext.projectFiles;
      debateOpts.projectContext = wsContext.projectContext;
    }
    if (isPlanModeActive()) {
      debateOpts.projectContext = {
        ...(debateOpts.projectContext ?? {}),
        planMode: true,
      };
    }
    if (bridge) {
      debateOpts.tools = bridge.tools;
      debateOpts.toolBudget = bridge.toolBudget;
    }
    debate = await client.createDebate(debateOpts);
  } catch (err: unknown) {
    tracker.fail(
      "createDebate",
      err instanceof Error ? err.message : "Create failed",
    );
    if (liveProgress) logUpdate.clear();
    const errMsg = err instanceof Error ? err.message : "Create failed";
    log("ERROR", "debate_failed", {
      error: errMsg,
      durationMs: Date.now() - debateStartTime,
    });
    if (headless) {
      emitFinalJson({
        ok: false,
        error: "Debate creation failed: " + errMsg,
        topic,
        mode,
        models,
      });
    } else {
      console.log(st.error("Debate creation failed"));
      console.error(st.error((err as Error).message));
    }
    process.exit(1);
  }

  log("INFO", "debate_started", {
    debateId: debate.id,
    data: { topic, mode, models },
  });

  tracker.complete("createDebate");
  tracker.start("startStream");
  renderProgress();

  let goldenPrompt = "";
  const handleEvent = headless ? null : createStreamHandlers({ topic, models });
  let aborted = false;
  let abortReason: string | undefined;

  const sigintHandler = async () => {
    try {
      await client.cancelDebate(debate.id);
    } catch (err: unknown) {
      log("WARN", "debate_cancel_failed", {
        debateId: debate.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    process.exit(0);
  };
  process.on("SIGINT", sigintHandler);

  async function maybeAbort(): Promise<boolean> {
    if (!budgetGuard) return false;
    const decision = budgetGuard.shouldAbort();
    if (!decision.abort || aborted) return aborted;
    aborted = true;
    abortReason = decision.reason;
    try {
      await client.cancelDebate(debate.id);
    } catch (err) {
      log("WARN", "debate_cancel_failed", {
        debateId: debate.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  try {
    await client.streamDebate(debate.id, (event: DebateEvent) => {
      if (event.type === "debate_start") {
        tracker.complete("startStream");
        if (liveProgress) logUpdate.clear();
      }
      if (event.type === "agent_complete") {
        budgetGuard?.recordTurn();
      }
      if (event.type === "consensus" && event.text) goldenPrompt = event.text;
      if (bridge && event.type === "tool:call_request") {
        bridge.handleEvent(event, debate.id).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          if (!headless) {
            console.error(st.warning(`[mcp] tool dispatch failed: ${msg}`));
          }
        });
      }
      if (streamJson) {
        emitStreamEvent({ type: event.type, data: event, ts: Date.now() });
      } else if (handleEvent) {
        handleEvent(event);
      }
      if (budgetGuard && !aborted) {
        const decision = budgetGuard.shouldAbort();
        if (decision.abort) {
          void maybeAbort();
        }
      }
    });
  } catch (error: unknown) {
    if (liveProgress) logUpdate.clear();
    const msg = error instanceof Error ? error.message : "Unknown error";
    if (aborted) {
      log("INFO", "debate_aborted", {
        debateId: debate.id,
        data: { reason: abortReason },
        durationMs: Date.now() - debateStartTime,
      });
    } else {
      log("ERROR", "debate_failed", {
        debateId: debate.id,
        error: msg,
        durationMs: Date.now() - debateStartTime,
      });
      if (headless) {
        emitFinalJson({
          ok: false,
          error: msg,
          topic,
          mode,
          models,
          debateId: debate.id,
        });
      } else {
        console.log(st.error("\n  Error: " + msg + "\n"));
        logStreamFailureHints(error);
      }
      process.exit(1);
    }
  } finally {
    process.removeListener("SIGINT", sigintHandler);
    if (bridge) {
      await bridge.shutdown().catch(() => {
        /* swallow shutdown errors */
      });
    }
  }

  log("INFO", "debate_completed", {
    debateId: debate.id,
    durationMs: Date.now() - debateStartTime,
  });

  writeDebateMemory(wsContext, topic, mode, goldenPrompt, debate.id);

  if (headless) {
    const payload: Record<string, unknown> = {
      ok: !aborted,
      synthesis: goldenPrompt,
      debateId: debate.id,
      topic,
      mode,
      models,
      budget: budgetGuard?.summary(),
    };
    if (aborted) {
      payload["aborted"] = true;
      payload["abortReason"] = abortReason;
    }
    if (streamJson) {
      emitStreamEvent({ type: "complete", data: payload, ts: Date.now() });
    } else {
      emitFinalJson(payload);
    }
    return goldenPrompt;
  }

  writeFormattedDebateOutput(
    goldenPrompt,
    outputFormat,
    topic,
    models,
    mode,
    debate.id,
  );

  if (aborted) {
    console.log(
      st.warning(`Debate aborted: ${abortReason ?? "limit reached"}`),
    );
  } else {
    console.log(st.success("Debate complete.\n"));
  }
  return goldenPrompt;
}

function maybePrintFreeTierNotice(models: string[]): void {
  const km = new KeyManager();
  const resolutions = km.resolveKeysForModels(models);
  const missing: string[] = [];
  for (const [model, key] of resolutions.entries()) {
    if (!key) missing.push(model);
  }
  if (missing.length === 0) return;
  console.log(
    st.dim(
      `  No provider key set for ${missing.length}/${models.length} model(s); ` +
        "the server will route them through Consilium's free tier (Groq / OpenRouter). " +
        "Add your key with `consilium config set <provider>` to use the original models.",
    ),
  );
}

export async function loadWorkspaceContext(
  options: DebateCommandOptions,
): Promise<WorkspaceDebateContext | null> {
  const ctx = await loadWorkspaceDebateContext({
    noContext: options.context === false,
    // git context is now default-on; --no-git (Commander -> options.git === false)
    // is the explicit opt-out. The legacy --git-diff flag is preserved as a
    // no-op alias since auto-collection makes it redundant.
    noGit: options.git === false,
    gitDiff: options.gitDiff,
    ticket: options.ticket,
  });

  if (!options.file || options.file.length === 0) return ctx;

  const attachedFiles: Array<{ name: string; content: string }> = [];
  for (const fp of options.file) {
    try {
      const content = fs.readFileSync(fp, "utf-8");
      attachedFiles.push({ name: path.basename(fp), content });
      console.log(st.dim(`  Attached: ${fp}`));
    } catch (err: unknown) {
      console.log(
        st.warning(
          `  Could not read file: ${fp} - ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  }

  if (attachedFiles.length === 0) return ctx;

  if (ctx) {
    ctx.files = [...ctx.files, ...attachedFiles];
    return ctx;
  }

  return {
    files: attachedFiles,
    projectFiles: [],
    projectContext: {},
    gitContextPrefix: "",
    ticketPrefix: "",
    memoryPrefix: "",
    rootPath: process.cwd(),
    contextManifest: {
      root: process.cwd(),
      loaded: attachedFiles.length,
      loadedBytes: attachedFiles.reduce((sum, f) => sum + f.content.length, 0),
      skipped: {
        secret: 0,
        binary: 0,
        "payload-limit": 0,
        "skip-rule": 0,
        "read-error": 0,
        "max-files": 0,
      },
      loadedPaths: attachedFiles.map((f) => f.name),
    },
  };
}

function buildDebateBackgroundArgs(
  topic: string,
  options: DebateCommandOptions,
): string[] {
  const args: string[] = [topic];
  if (options.mode) args.push("--mode", options.mode);
  if (options.models && options.models.length > 0) {
    args.push("--models", ...options.models);
  }
  if (options.output) args.push("--output", options.output);
  if (options.outputFormat) args.push("--output-format", options.outputFormat);
  if (options.jsonSchema) args.push("--json-schema", options.jsonSchema);
  if (options.maxBudgetUsd) args.push("--max-budget-usd", options.maxBudgetUsd);
  if (options.maxTurns) args.push("--max-turns", options.maxTurns);
  if (options.ticket) args.push("--ticket", options.ticket);
  if (options.file && options.file.length > 0) {
    args.push("--file", ...options.file);
  }
  if (options.gitDiff) args.push("--git-diff");
  if (options.git === false) args.push("--no-git");
  if (options.tools === false) args.push("--no-tools");
  if (options.context === false) args.push("--no-context");
  if (options.apply) args.push("--apply");
  if (options.plan) args.push("--plan");
  return args;
}

async function runDebateInBackground(
  topic: string,
  options: DebateCommandOptions,
): Promise<void> {
  const args = buildDebateBackgroundArgs(topic, options);
  try {
    const record = await spawnDetached({ command: "debate", args });
    console.log(st.success("Debate started in background."));
    console.log(st.dim(`  id:   ${record.id}`));
    console.log(st.dim(`  pid:  ${record.pid}`));
    console.log(st.dim(`  log:  ${record.logPath}`));
    console.log("");
    console.log(st.brand("  Attach:"));
    console.log(st.dim(`    consilium agents attach ${record.id}`));
    console.log(st.dim(`    consilium agents logs ${record.id} -f`));
    console.log(st.dim(`    consilium agents stop ${record.id}`));
    console.log("");
  } catch (err) {
    console.error(
      st.error(`Failed to start background debate: ${(err as Error).message}`),
    );
    process.exit(1);
  }
}

export async function debateCommand(
  topic: string,
  options: DebateCommandOptions,
): Promise<void> {
  if (options.bg && process.env["CONSILIUM_BG_AGENT"] !== "1") {
    await runDebateInBackground(topic, options);
    return;
  }

  await requireAuth();

  const mode: DebateMode =
    options.mode && isValidMode(options.mode) ? options.mode : getDefaultMode();
  const outputFormat: OutputFormat =
    options.output && isValidOutputFormat(options.output)
      ? options.output
      : "text";

  const headlessFormat = resolveHeadlessFormat(options.outputFormat);
  const headless = isHeadlessFormat(headlessFormat);
  const maxBudgetUsd = parsePositiveNumber(options.maxBudgetUsd);
  const maxTurns = parsePositiveNumber(options.maxTurns);
  const budgetGuard =
    maxBudgetUsd !== undefined || maxTurns !== undefined
      ? new BudgetGuard(maxBudgetUsd, maxTurns)
      : undefined;

  if (!headless) {
    warnDebateCommandOptions(options, mode, outputFormat);
  }

  if (options.sandbox) {
    const caps = detectSandboxCapabilities();
    if (caps.available) {
      process.env["CONSILIUM_SANDBOX_MODE"] = "1";
      process.env["CONSILIUM_SANDBOX_MECHANISM"] = caps.mechanism;
      process.env["CONSILIUM_SANDBOX_PLATFORM"] = caps.platform;
      if (!headless) {
        console.log(
          st.dim(
            `[SANDBOX] Native sandboxing active (platform: ${caps.platform}, mechanism: ${caps.mechanism}).`,
          ),
        );
      }
    } else {
      const availability = isSandboxAvailable();
      const reason =
        caps.reason ?? availability.reason ?? "Sandbox unavailable.";
      if (!headless) {
        console.log(st.warning(`[SANDBOX] ${reason}`));
      }
      if (!options.noSandboxStrict) {
        if (headless) {
          process.stderr.write(`[SANDBOX] ${reason}\n`);
        } else {
          console.log(
            st.dim(
              "Pass --no-sandbox-strict to continue without native sandboxing, or use --worktree for git-level isolation.",
            ),
          );
        }
        process.exit(1);
      }
    }
  }

  if (options.worktree) {
    const branch =
      typeof options.worktree === "string" && options.worktree.length > 0
        ? options.worktree
        : undefined;
    try {
      const ref = await createWorktree(branch);
      if (!headless) {
        console.log(
          st.success(`Created worktree at ${ref.path} on branch ${ref.branch}`),
        );
      }
      process.chdir(ref.path);
    } catch (err) {
      if (!headless) {
        console.log(
          st.warning(
            `--worktree failed: ${(err as Error).message}. Continuing in current directory.`,
          ),
        );
      }
    }
  }

  if (options.plan && !headless) {
    enterPlanMode();
    console.log(
      st.brand(
        "Entering plan mode - no write tools will execute until you approve.",
      ),
    );
  }

  const prefs = await getPreferences();
  const models = options.models || prefs.defaultAgents;
  if (!headless) {
    const estimate = estimateCost(mode, models.length);
    console.log(st.dim(formatCostEstimate(estimate)));
    maybePrintFreeTierNotice(models);
  }

  const wsContext = await loadWorkspaceContext(options);

  const client = new ConsiliumClient();
  const useLiveProgress = terminal.isTTY && !terminal.usePlain;
  const useDeliberation = ["redteam", "jury", "market"].includes(mode);
  let synthesis = "";
  let currentTopic = topic;
  if (useDeliberation) {
    synthesis = await runDeliberation(
      client,
      currentTopic,
      mode,
      models,
      outputFormat,
      useLiveProgress,
      wsContext,
      { headlessFormat, budgetGuard },
    );
  } else {
    synthesis = await runClassicDebateFlow(
      client,
      currentTopic,
      mode,
      models,
      outputFormat,
      useLiveProgress,
      { ...options, wsContext, headlessFormat, budgetGuard },
    );
  }

  if (options.jsonSchema) {
    const result = validateAgainstSchema(
      parseSynthesisForSchema(synthesis),
      options.jsonSchema,
    );
    if (!result.ok) {
      const lines = ["Schema validation failed:"];
      for (const e of result.errors ?? []) lines.push("  - " + e);
      process.stderr.write(lines.join("\n") + "\n");
      process.exit(2);
    }
  }

  if (options.plan && !headless) {
    let refining = true;
    while (refining) {
      refining = false;
      extractPlanSteps(synthesis);
      console.log("\n" + renderPlan() + "\n");
      const decision = await promptApproval();
      if (decision === "approve") {
        exitPlanMode();
        console.log(
          st.success(
            "Plan approved. Re-run without --plan to execute, or use `/plan` then continue.",
          ),
        );
        return;
      }
      if (decision === "refine") {
        const refinement = await promptRefinement();
        if (!refinement) {
          clearPlan();
          exitPlanMode();
          console.log(st.dim("Plan refinement cancelled."));
          return;
        }
        clearPlan();
        currentTopic = `Refinement: ${refinement}\n\nOriginal topic: ${topic}`;
        synthesis = await runClassicDebateFlow(
          client,
          currentTopic,
          mode,
          models,
          outputFormat,
          useLiveProgress,
          { ...options, wsContext, headlessFormat, budgetGuard },
        );
        refining = true;
        continue;
      }
      clearPlan();
      exitPlanMode();
      console.log(st.warning("Plan cancelled."));
      return;
    }
  }

  if (options.apply && !headless) {
    await maybeApplySynthesisEdits(
      synthesis,
      wsContext?.rootPath || resolveProjectRoot(process.cwd()).root,
    );
  }

  if (!headless) {
    await maybeGenerateDebateImage(options, topic, synthesis);
  }

  if (terminal.isTTY && !options.apply && !headless) {
    await offerFollowUp(
      client,
      synthesis,
      mode,
      models,
      outputFormat,
      wsContext,
      options,
    );
  }
}

function parseSynthesisForSchema(synthesis: string): unknown {
  const trimmed = synthesis.trim();
  if (!trimmed) return {};
  const fence = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i);
  const candidate = fence?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    return { synthesis };
  }
}

function extractPlanSteps(synthesis: string): void {
  if (!synthesis) return;
  if (getPlan().length > 0) return;
  const lines = synthesis.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    const match = line.match(/^(?:[-*+]|\d+[.)])\s+(.*\S)/);
    if (match && match[1]) {
      recordPlanStep(match[1]);
    }
  }
}

async function promptRefinement(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await new Promise<string>((resolve) => {
      rl.question(st.dim("Refinement (blank to cancel): "), (raw) =>
        resolve(raw.trim()),
      );
    });
  } finally {
    rl.close();
  }
}

async function offerFollowUp(
  client: ConsiliumClient,
  previousSynthesis: string,
  mode: DebateMode,
  models: string[],
  outputFormat: OutputFormat,
  wsContext?: WorkspaceDebateContext | null,
  options?: { tools?: boolean },
): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ask = (q: string): Promise<string> =>
    new Promise((r) => rl.question(q, r));

  while (true) {
    const followUp = await ask(st.dim("\nFollow-up (or Enter to exit): "));
    if (!followUp.trim()) {
      rl.close();
      return;
    }

    const contextualTopic = `Previous answer:\n${previousSynthesis.slice(0, 4000)}\n\nFollow-up question: ${followUp.trim()}`;
    const useLiveProgress = terminal.isTTY && !terminal.usePlain;
    const useDeliberation = ["redteam", "jury", "market"].includes(mode);

    let synthesis = "";
    if (useDeliberation) {
      synthesis = await runDeliberation(
        client,
        contextualTopic,
        mode,
        models,
        outputFormat,
        useLiveProgress,
        wsContext,
      );
    } else {
      synthesis = await runClassicDebateFlow(
        client,
        contextualTopic,
        mode,
        models,
        outputFormat,
        useLiveProgress,
        { ...options, wsContext },
      );
    }
    previousSynthesis = synthesis;
  }
}

interface DeliberationFlowExtras {
  headlessFormat?: HeadlessOutputFormat;
  budgetGuard?: BudgetGuard;
}

async function runDeliberation(
  client: ConsiliumClient,
  topic: string,
  mode: DebateMode,
  models: string[],
  outputFormat: OutputFormat,
  useLiveProgress: boolean,
  wsContext?: WorkspaceDebateContext | null,
  extras?: DeliberationFlowExtras,
): Promise<string> {
  const startTime = Date.now();
  const headlessFormat = extras?.headlessFormat ?? "text";
  const headless = isHeadlessFormat(headlessFormat);
  const streamJson = headlessFormat === "stream-json";
  const budgetGuard = extras?.budgetGuard;
  const liveProgress = useLiveProgress && !headless;

  if (!headless) {
    console.log(st.brand(`\n  Deliberation mode: ${mode}\n`));
  }

  let deliberation: { id: string };
  try {
    const delibContextParts = [
      wsContext?.memoryPrefix,
      wsContext?.ticketPrefix,
      wsContext?.gitContextPrefix,
    ]
      .filter(Boolean)
      .join("");
    const effectiveDelibTopic = delibContextParts
      ? delibContextParts + topic
      : topic;
    deliberation = await client.createDeliberation(effectiveDelibTopic, {
      models,
      mode,
      debateSource: "cli",
      ...(wsContext && {
        files: wsContext.files,
        projectFiles: wsContext.projectFiles,
        projectContext: wsContext.projectContext,
      }),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Create failed";
    log("ERROR", "deliberation_failed", { error: msg });
    if (headless) {
      emitFinalJson({
        ok: false,
        error: "Deliberation creation failed: " + msg,
        topic,
        mode,
        models,
      });
    } else {
      console.log(st.error("Deliberation creation failed: " + msg));
    }
    process.exit(1);
  }

  log("INFO", "deliberation_started", {
    debateId: deliberation.id,
    data: { topic, mode, models },
  });

  const ctx: DeliberationStreamCtx = {
    deliberationId: deliberation.id,
    useLiveProgress: liveProgress,
    currentPhase: "",
    modelProgress: new Map<string, number>(),
    convergence: null,
    dissents: [],
    votes: [],
    costs: [],
    resultText: "",
  };

  let aborted = false;
  let abortReason: string | undefined;

  async function maybeAbort(): Promise<void> {
    if (!budgetGuard || aborted) return;
    const decision = budgetGuard.shouldAbort();
    if (!decision.abort) return;
    aborted = true;
    abortReason = decision.reason;
  }

  try {
    await client.streamDeliberation(
      deliberation.id,
      (event: DeliberationEvent) => {
        if (event.type === "cost_update" && event.cost) {
          budgetGuard?.recordTurnCost(event.cost.cost);
        }
        if (event.type === "phase_change") {
          budgetGuard?.recordTurn();
        }
        if (headless) {
          if (event.type === "deliberation_complete" && event.text) {
            ctx.resultText = event.text;
          }
          if (event.type === "cost_update" && event.cost) {
            ctx.costs.push(event.cost);
          }
          if (event.type === "dissent_detected" && event.dissent) {
            ctx.dissents.push(event.dissent);
          }
          if (event.type === "vote_cast" && event.vote) {
            ctx.votes.push(event.vote);
          }
          if (streamJson) {
            emitStreamEvent({
              type: event.type,
              data: event,
              ts: Date.now(),
            });
          }
        } else {
          processDeliberationEvent(event, ctx);
        }
        void maybeAbort();
      },
    );
  } catch (error: unknown) {
    if (liveProgress) logUpdate.clear();
    const msg = error instanceof Error ? error.message : "Unknown error";
    if (!aborted) {
      log("ERROR", "deliberation_failed", {
        debateId: deliberation.id,
        error: msg,
        durationMs: Date.now() - startTime,
      });
      if (headless) {
        emitFinalJson({
          ok: false,
          error: msg,
          topic,
          mode,
          models,
          debateId: deliberation.id,
        });
      } else {
        console.log(st.error("\n  Error: " + msg + "\n"));
        logStreamFailureHints(error);
      }
      process.exit(1);
    }
  }

  log("INFO", "deliberation_completed", {
    debateId: deliberation.id,
    durationMs: Date.now() - startTime,
  });

  writeDebateMemory(wsContext, topic, mode, ctx.resultText, deliberation.id);

  if (headless) {
    const payload: Record<string, unknown> = {
      ok: !aborted,
      synthesis: ctx.resultText,
      debateId: deliberation.id,
      topic,
      mode,
      models,
      dissents: ctx.dissents,
      votes: ctx.votes,
      costs: ctx.costs,
      budget: budgetGuard?.summary(),
    };
    if (aborted) {
      payload["aborted"] = true;
      payload["abortReason"] = abortReason;
    }
    if (streamJson) {
      emitStreamEvent({ type: "complete", data: payload, ts: Date.now() });
    } else {
      emitFinalJson(payload);
    }
    return ctx.resultText;
  }

  if (ctx.dissents.length > 0) {
    console.log(st.warning("\n  Dissent report:"));
    for (const d of ctx.dissents) {
      console.log(st.warning(`    ${d.agent}: ${d.reason}`));
    }
  }

  if (ctx.votes.length > 0) {
    console.log(st.dim("\n  Votes:"));
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

  console.log(renderCostBreakdown(ctx.costs));

  writeFormattedDebateOutput(
    ctx.resultText,
    outputFormat,
    topic,
    models,
    mode,
    deliberation.id,
  );

  if (aborted) {
    console.log(
      st.warning(`Deliberation aborted: ${abortReason ?? "limit reached"}`),
    );
  } else {
    console.log(st.success("\nDeliberation complete.\n"));
  }
  return ctx.resultText;
}

async function maybeApplySynthesisEdits(
  synthesis: string,
  rootPath: string,
): Promise<void> {
  if (!synthesis) {
    console.log(st.dim("No synthesis text available for edit application."));
    return;
  }

  const parsed = parseEditsFromSynthesis(synthesis, rootPath);
  if (parsed.edits.length === 0) {
    console.log(st.dim("No structured edit actions found in synthesis."));
    return;
  }

  console.log(st.bold("\nPlanned edits\n"));
  console.log(formatEditPreview(parsed.preview));
  console.log("");

  const permission = await requestWritePermission(rootPath);
  if (permission === "deny" || !consumeWritePermission(rootPath)) {
    console.log(st.warning("Write permission denied. Skipping edit apply.\n"));
    return;
  }

  const result = applyEdits(rootPath, parsed.edits);
  console.log(
    st.success(`Applied ${result.applied} edit(s).`),
    st.dim(`Rollback snapshot: ${result.snapshot.id}\n`),
  );
}
