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
  const stepIds: string[] = ["health", "createDebate", "startStream"];
  const tracker = createStepTracker(stepIds, STEP_LABELS);

  const renderProgress = () => {
    if (useLiveProgress) {
      logUpdate(tracker.render("Initializing"));
    }
  };

  tracker.start("health");
  renderProgress();
  const isHealthy = await client.healthCheck();

  if (!isHealthy) {
    if (useLiveProgress) logUpdate.clear();
    console.log(st.error("API is not available"));
    process.exit(1);
  }

  tracker.complete("health");
  tracker.start("createDebate");
  renderProgress();

  // Start the agent toolkit bridge by default (--no-tools opts out).
  // Vision: Consilium debates the codebase; making file/grep/edit tools
  // opt-in meant most debates ran blind.
  const toolsEnabled = options?.tools !== false;
  let bridge: ToolBridgeHandle | null = null;
  if (toolsEnabled) {
    try {
      bridge = await startToolBridge(client, { enabled: true, quiet: false });
    } catch (err) {
      // Bridge startup failure is non-fatal - fall through to a tool-less debate
      // so the user still gets an answer instead of a hard exit.
      console.log(
        st.warning(`  Could not start tool bridge: ${(err as Error).message}`),
      );
      console.log(st.dim("  Continuing without agent file tools."));
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
    if (useLiveProgress) logUpdate.clear();
    log("ERROR", "debate_failed", {
      error: err instanceof Error ? err.message : "Create failed",
      durationMs: Date.now() - debateStartTime,
    });
    console.log(st.error("Debate creation failed"));
    console.error(st.error((err as Error).message));
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
  const handleEvent = createStreamHandlers({ topic });

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

  try {
    await client.streamDebate(debate.id, (event: DebateEvent) => {
      if (event.type === "debate_start") {
        tracker.complete("startStream");
        if (useLiveProgress) logUpdate.clear();
      }
      if (event.type === "consensus" && event.text) goldenPrompt = event.text;
      // Route tool:call_request events to the bridge so the agents'
      // Read/Edit/Grep/etc. calls are answered locally. Fire-and-forget;
      // the bridge handles its own errors and posts results back to the
      // engine via postToolResult.
      if (bridge && event.type === "tool:call_request") {
        bridge.handleEvent(event, debate.id).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(st.warning(`[mcp] tool dispatch failed: ${msg}`));
        });
      }
      handleEvent(event);
    });
  } catch (error: unknown) {
    if (useLiveProgress) logUpdate.clear();
    const msg = error instanceof Error ? error.message : "Unknown error";
    log("ERROR", "debate_failed", {
      debateId: debate.id,
      error: msg,
      durationMs: Date.now() - debateStartTime,
    });
    console.log(st.error("\n  Error: " + msg + "\n"));
    logStreamFailureHints(error);
    process.exit(1);
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

  writeFormattedDebateOutput(
    goldenPrompt,
    outputFormat,
    topic,
    models,
    mode,
    debate.id,
  );

  console.log(st.success("Debate complete.\n"));
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

export async function debateCommand(
  topic: string,
  options: DebateCommandOptions,
): Promise<void> {
  await requireAuth();

  const mode: DebateMode =
    options.mode && isValidMode(options.mode) ? options.mode : getDefaultMode();
  const outputFormat: OutputFormat =
    options.output && isValidOutputFormat(options.output)
      ? options.output
      : "text";

  warnDebateCommandOptions(options, mode, outputFormat);

  const prefs = await getPreferences();
  const models = options.models || prefs.defaultAgents;
  const estimate = estimateCost(mode, models.length);
  console.log(st.dim(formatCostEstimate(estimate)));

  maybePrintFreeTierNotice(models);

  const wsContext = await loadWorkspaceContext(options);

  const client = new ConsiliumClient();
  const useLiveProgress = terminal.isTTY && !terminal.usePlain;
  let synthesis = "";
  synthesis = await runClassicDebateFlow(
    client,
    topic,
    mode,
    models,
    outputFormat,
    useLiveProgress,
    { ...options, wsContext },
  );

  if (options.apply) {
    await maybeApplySynthesisEdits(
      synthesis,
      wsContext?.rootPath || resolveProjectRoot(process.cwd()).root,
    );
  }

  if (terminal.isTTY && !options.apply) {
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

async function runDeliberation(
  client: ConsiliumClient,
  topic: string,
  mode: DebateMode,
  models: string[],
  outputFormat: OutputFormat,
  useLiveProgress: boolean,
  wsContext?: WorkspaceDebateContext | null,
): Promise<string> {
  const startTime = Date.now();

  console.log(st.brand(`\n  Deliberation mode: ${mode}\n`));

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
    console.log(st.error("Deliberation creation failed: " + msg));
    process.exit(1);
  }

  log("INFO", "deliberation_started", {
    debateId: deliberation.id,
    data: { topic, mode, models },
  });

  const ctx: DeliberationStreamCtx = {
    deliberationId: deliberation.id,
    useLiveProgress,
    currentPhase: "",
    modelProgress: new Map<string, number>(),
    convergence: null,
    dissents: [],
    votes: [],
    costs: [],
    resultText: "",
  };

  try {
    await client.streamDeliberation(
      deliberation.id,
      (event: DeliberationEvent) => {
        processDeliberationEvent(event, ctx);
      },
    );
  } catch (error: unknown) {
    if (useLiveProgress) logUpdate.clear();
    const msg = error instanceof Error ? error.message : "Unknown error";
    log("ERROR", "deliberation_failed", {
      debateId: deliberation.id,
      error: msg,
      durationMs: Date.now() - startTime,
    });
    console.log(st.error("\n  Error: " + msg + "\n"));
    logStreamFailureHints(error);
    process.exit(1);
  }

  log("INFO", "deliberation_completed", {
    debateId: deliberation.id,
    durationMs: Date.now() - startTime,
  });

  writeDebateMemory(wsContext, topic, mode, ctx.resultText, deliberation.id);

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

  console.log(st.success("\nDeliberation complete.\n"));
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
