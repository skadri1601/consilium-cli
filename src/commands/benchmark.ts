import fs from "node:fs";
import { ConsiliumClient, DeliberationEvent } from "../api/client";
import { requireAuth } from "../utils/require-auth";
import { style } from "../utils/visual-system";
import { terminal } from "../utils/terminal-capabilities";
import { log } from "../utils/logger";
import logUpdate from "log-update";

const st = style();

const VALID_BENCHMARKS = ["mmlu", "truthfulqa", "humaneval"] as const;
type BenchmarkName = (typeof VALID_BENCHMARKS)[number];

export interface BenchmarkCommandOptions {
  benchmark: string;
  models?: string[];
  mode?: string;
  n?: string;
  output?: string;
  local?: boolean;
}

interface BenchmarkProgress {
  currentQuestion: number;
  totalQuestions: number;
  singleCorrect: number;
  deliberationCorrect: number;
  costSoFar: number;
  currentCategory: string;
}

interface BenchmarkResultData {
  benchmark_name: string;
  single_model_score: number;
  deliberation_score: number;
  improvement_pct: number;
  num_questions: number;
  cost_single: number;
  cost_deliberation: number;
  details: Array<{
    category: string;
    single: {
      question: string;
      model_answer: string;
      correct: boolean;
      model_id: string;
    };
    deliberation: {
      question: string;
      golden_prompt_answer: string;
      correct: boolean;
      votes: Record<string, string>;
      rounds_used: number;
    };
  }>;
}

function renderProgressDisplay(progress: BenchmarkProgress): string {
  const pct = Math.round(
    (progress.currentQuestion / progress.totalQuestions) * 100,
  );
  const filled = Math.round((30 * Math.min(100, pct)) / 100);
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(30 - filled);

  const singleAcc =
    progress.currentQuestion > 0
      ? ((progress.singleCorrect / progress.currentQuestion) * 100).toFixed(1)
      : "0.0";
  const delibAcc =
    progress.currentQuestion > 0
      ? (
          (progress.deliberationCorrect / progress.currentQuestion) *
          100
        ).toFixed(1)
      : "0.0";

  const lines = [
    st.brand(`  Benchmark Progress`),
    "",
    `  [${bar}] ${progress.currentQuestion}/${progress.totalQuestions} (${pct}%)`,
    "",
    st.dim(`  Single accuracy:       ${singleAcc}%`),
    st.dim(`  Deliberation accuracy: ${delibAcc}%`),
    st.dim(`  Cost so far:           $${progress.costSoFar.toFixed(4)}`),
    st.dim(`  Current category:      ${progress.currentCategory}`),
  ];
  return lines.join("\n");
}

function renderResultsTable(result: BenchmarkResultData): string {
  const metricCol = "Metric".padEnd(14);
  const singleCol = "Single Model".padEnd(14);
  const delibCol = "Deliberation".padEnd(14);
  const ruleW = 14 + 14 + 14 + 8;

  const singlePct = `${(result.single_model_score * 100).toFixed(1)}%`.padEnd(
    14,
  );
  const delibPct = `${(result.deliberation_score * 100).toFixed(1)}%`.padEnd(
    14,
  );
  const singleCost = `$${result.cost_single.toFixed(4)}`.padEnd(14);
  const delibCost = `$${result.cost_deliberation.toFixed(4)}`.padEnd(14);
  const qCount = `${result.num_questions}`.padEnd(14);
  const sign = result.improvement_pct >= 0 ? "+" : "";
  const improvementStr = `${sign}${result.improvement_pct.toFixed(1)}%`;

  const headerLines = [
    st.brand(`\n  Benchmark Report: ${result.benchmark_name.toUpperCase()}`),
    "",
    st.dim(`  ${"".padEnd(ruleW, "-")}`),
    `  ${st.bold(metricCol)} ${st.bold(singleCol)} ${st.bold(delibCol)}`,
    st.dim(`  ${"".padEnd(ruleW, "-")}`),
    `  ${"Accuracy".padEnd(14)} ${singlePct} ${delibPct}`,
    `  ${"Cost".padEnd(14)} ${singleCost} ${delibCost}`,
    `  ${"Questions".padEnd(14)} ${qCount} ${qCount}`,
    st.dim(`  ${"".padEnd(ruleW, "-")}`),
    "",
    st.brand(`  Improvement: ${improvementStr}`),
  ];

  if (result.details.length === 0) {
    return headerLines.join("\n");
  }

  const numCol = "#".padEnd(4);
  const catCol = "Category".padEnd(14);
  const sCol = "Single".padEnd(8);
  const dCol = "Delib".padEnd(8);
  const rCol = "Rounds".padEnd(8);
  const detailRuleW = 4 + 14 + 8 + 8 + 8 + 4;

  const detailHeader = [
    "",
    st.bold("  Per-Question Results"),
    "",
    st.dim(`  ${"".padEnd(detailRuleW, "-")}`),
    `  ${st.bold(numCol)} ${st.bold(catCol)} ${st.bold(sCol)} ${st.bold(dCol)} ${st.bold(rCol)}`,
    st.dim(`  ${"".padEnd(detailRuleW, "-")}`),
  ];

  const detailRows = result.details.map((d, i) => {
    const singleMark = d.single.correct ? st.success("pass") : st.error("fail");
    const delibMark = d.deliberation.correct
      ? st.success("pass")
      : st.error("fail");
    const num = `${i + 1}`.padEnd(4);
    const cat = d.category.padEnd(14);
    const rounds = `${d.deliberation.rounds_used}`.padEnd(8);
    return `  ${num} ${cat} ${singleMark.padEnd(8)} ${delibMark.padEnd(8)} ${rounds}`;
  });

  return [
    ...headerLines,
    ...detailHeader,
    ...detailRows,
    st.dim(`  ${"".padEnd(detailRuleW, "-")}`),
  ].join("\n");
}

function assertValidBenchmark(options: BenchmarkCommandOptions): void {
  if (
    !options.benchmark ||
    !VALID_BENCHMARKS.includes(options.benchmark as BenchmarkName)
  ) {
    console.log(
      st.error(
        `Invalid benchmark "${options.benchmark}". Valid: ${VALID_BENCHMARKS.join(", ")}`,
      ),
    );
    process.exit(1);
  }
}

function parseQuestionCount(n: string | undefined): number | undefined {
  if (!n) return undefined;
  const parsed = Number.parseInt(n, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    console.log(st.error("--n must be a positive integer"));
    process.exit(1);
  }
  return parsed;
}

function applyPhaseChangeEvent(
  event: DeliberationEvent,
  progress: BenchmarkProgress,
): void {
  if (event.phase === "benchmark_start" && event.progress !== undefined) {
    progress.totalQuestions = event.progress;
  }
}

function applyModelProgressEvent(
  event: DeliberationEvent,
  progress: BenchmarkProgress,
  useLiveProgress: boolean,
): void {
  if (event.progress !== undefined) {
    progress.currentQuestion = event.progress;
  }
  if (event.agent) {
    progress.currentCategory = event.agent;
  }
  if (useLiveProgress) {
    logUpdate(renderProgressDisplay(progress));
    return;
  }
  const pct =
    progress.totalQuestions > 0
      ? Math.round((progress.currentQuestion / progress.totalQuestions) * 100)
      : 0;
  console.log(
    st.dim(
      `  Question ${progress.currentQuestion}/${progress.totalQuestions} (${pct}%) - ${progress.currentCategory}`,
    ),
  );
}

function applyConvergenceUpdateEvent(
  event: DeliberationEvent,
  progress: BenchmarkProgress,
  useLiveProgress: boolean,
): void {
  if (event.convergence !== undefined) {
    const data = event as DeliberationEvent & {
      single_correct?: number;
      deliberation_correct?: number;
    };
    if (data.single_correct !== undefined)
      progress.singleCorrect = data.single_correct;
    if (data.deliberation_correct !== undefined)
      progress.deliberationCorrect = data.deliberation_correct;
  }
  if (useLiveProgress) {
    logUpdate(renderProgressDisplay(progress));
  }
}

function applyCostUpdateEvent(
  event: DeliberationEvent,
  progress: BenchmarkProgress,
  useLiveProgress: boolean,
): void {
  if (event.cost) {
    progress.costSoFar += event.cost.cost;
  }
  if (useLiveProgress) {
    logUpdate(renderProgressDisplay(progress));
  }
}

function handleBenchmarkStreamEvent(
  event: DeliberationEvent,
  progress: BenchmarkProgress,
  useLiveProgress: boolean,
): BenchmarkResultData | null | "error" {
  switch (event.type) {
    case "phase_change":
      applyPhaseChangeEvent(event, progress);
      return null;
    case "model_progress":
      applyModelProgressEvent(event, progress, useLiveProgress);
      return null;
    case "convergence_update":
      applyConvergenceUpdateEvent(event, progress, useLiveProgress);
      return null;
    case "cost_update":
      applyCostUpdateEvent(event, progress, useLiveProgress);
      return null;
    case "deliberation_complete":
      if (useLiveProgress) logUpdate.clear();
      if (event.text) {
        try {
          return JSON.parse(event.text) as BenchmarkResultData;
        } catch (err: unknown) {
          log("WARN", "benchmark_result_parse_failed", {
            error: err instanceof Error ? err.message : String(err),
          });
          return null;
        }
      }
      return null;
    case "error":
      if (useLiveProgress) logUpdate.clear();
      return "error";
    default:
      return null;
  }
}

async function runRemoteBenchmark(
  options: BenchmarkCommandOptions,
  models: string[],
  mode: string,
  n: number | undefined,
  useLiveProgress: boolean,
  startTime: number,
): Promise<void> {
  const client = new ConsiliumClient();
  const isHealthy = await client.healthCheck();
  if (!isHealthy) {
    console.log(st.error("API is not available"));
    process.exit(1);
  }

  let benchmarkRun: { id: string };
  try {
    benchmarkRun = await client.createBenchmark({
      benchmark: options.benchmark,
      models,
      mode,
      n,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Create failed";
    log("ERROR", "benchmark_failed", {
      error: msg,
      data: { benchmark: options.benchmark },
    });
    console.log(st.error("Benchmark creation failed: " + msg));
    process.exit(1);
  }

  log("INFO", "benchmark_started", {
    data: {
      benchmarkId: benchmarkRun.id,
      benchmark: options.benchmark,
      models,
      mode,
      n,
    },
  });

  const progress: BenchmarkProgress = {
    currentQuestion: 0,
    totalQuestions: n || 50,
    singleCorrect: 0,
    deliberationCorrect: 0,
    costSoFar: 0,
    currentCategory: "",
  };

  let resultData: BenchmarkResultData | null = null;

  const sigintHandler = async () => {
    if (useLiveProgress) logUpdate.clear();
    console.log(st.warning("\n  Benchmark cancelled"));
    process.exit(0);
  };
  process.on("SIGINT", sigintHandler);

  try {
    await client.streamBenchmark(
      benchmarkRun.id,
      (event: DeliberationEvent) => {
        const outcome = handleBenchmarkStreamEvent(
          event,
          progress,
          useLiveProgress,
        );
        if (outcome === "error") {
          throw new Error(event.error || "Benchmark error");
        }
        if (outcome !== null) {
          resultData = outcome;
        }
      },
    );
  } catch (error: unknown) {
    if (useLiveProgress) logUpdate.clear();
    const msg = error instanceof Error ? error.message : "Unknown error";
    log("ERROR", "benchmark_failed", {
      error: msg,
      durationMs: Date.now() - startTime,
      data: { benchmarkId: benchmarkRun.id },
    });
    console.log(st.error("\n  Error: " + msg + "\n"));
    process.exit(1);
  } finally {
    process.removeListener("SIGINT", sigintHandler);
  }

  log("INFO", "benchmark_completed", {
    durationMs: Date.now() - startTime,
    data: { benchmarkId: benchmarkRun.id },
  });

  if (resultData) {
    console.log(renderResultsTable(resultData));
  }

  if (resultData && options.output) {
    fs.writeFileSync(
      options.output,
      JSON.stringify(resultData, null, 2),
      "utf-8",
    );
    console.log(st.success(`\n  Results saved to ${options.output}`));
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(st.success(`\n  Benchmark complete. (${elapsed}s)\n`));
}

export async function benchmarkCommand(
  options: BenchmarkCommandOptions,
): Promise<void> {
  await requireAuth();
  assertValidBenchmark(options);

  const models = options.models || [
    "gpt-5.4-mini",
    "claude-haiku-4-5-20251001",
    "gemini-3-flash-preview",
  ];
  const mode = options.mode || "council";
  const n = parseQuestionCount(options.n);

  const useLiveProgress = terminal.isTTY && !terminal.usePlain;
  const startTime = Date.now();

  console.log(st.brand("\n  Benchmark Runner\n"));
  console.log(st.dim(`  Benchmark:  ${options.benchmark}`));
  console.log(st.dim(`  Models:     ${models.join(", ")}`));
  console.log(st.dim(`  Mode:       ${mode}`));
  if (n !== undefined) console.log(st.dim(`  Questions:  ${n}`));
  if (options.local) console.log(st.dim(`  Execution:  local`));
  console.log("");

  if (!options.local) {
    console.log(
      st.warning(
        "Remote benchmarks are not yet available. Use --local to run via the Python agent.\n",
      ),
    );
    console.log(
      st.dim("  Example: consilium benchmark --benchmark mmlu -n 10 --local\n"),
    );
    process.exit(1);
  }

  await runLocalBenchmark(
    options.benchmark,
    models,
    mode,
    n,
    options.output,
    useLiveProgress,
    startTime,
  );
}

async function runLocalBenchmark(
  benchmark: string,
  models: string[],
  mode: string,
  n: number | undefined,
  output: string | undefined,
  useLiveProgress: boolean,
  startTime: number,
): Promise<void> {
  const { spawn } = await import("node:child_process");

  const args = [
    "-m",
    "src.features.deliberation.benchmarks.runner",
    "--benchmark",
    benchmark,
    "--models",
    models.join(","),
    "--mode",
    mode,
  ];
  if (n !== undefined) args.push("--n", String(n));
  if (output) args.push("--output", output);

  console.log(st.dim("  Running benchmark locally via Python...\n"));

  const child = spawn("python", args, {
    cwd: process.env.CONSILIUM_AGENTS_DIR || "apps/agents",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (data: Buffer) => {
    const text = data.toString();
    stdout += text;
    if (!useLiveProgress) {
      process.stdout.write(text);
    }
  });

  child.stderr.on("data", (data: Buffer) => {
    stderr += data.toString();
  });

  return new Promise((resolve) => {
    child.on("close", (code: number | null) => {
      if (code !== 0) {
        log("ERROR", "benchmark_local_failed", {
          error: stderr,
          durationMs: Date.now() - startTime,
        });
        console.log(st.error(`\n  Local benchmark failed (exit code ${code})`));
        if (stderr) console.log(st.dim(stderr));
        process.exit(1);
      }

      if (useLiveProgress && stdout) {
        console.log(stdout);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      log("INFO", "benchmark_local_completed", {
        durationMs: Date.now() - startTime,
      });
      console.log(st.success(`\n  Local benchmark complete. (${elapsed}s)\n`));
      resolve();
    });
  });
}
