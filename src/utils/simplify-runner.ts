import { spawn } from "node:child_process";

export interface SimplifyInput {
  recentEdits: string;
  reviewerCount?: number;
  timeoutMs?: number;
  cwd?: string;
}

export interface ReviewFinding {
  reviewer: string;
  severity: "critical" | "major" | "minor" | "nit";
  file?: string;
  line?: number;
  message: string;
}

export interface SimplifyResult {
  findings: ReviewFinding[];
  consensusFixes: string[];
}

interface ReviewerSpec {
  name: string;
  focus: string;
}

const DEFAULT_REVIEWERS: ReviewerSpec[] = [
  {
    name: "simplicity-reviewer",
    focus:
      "Code reviewer focused on simplicity and dead code. Flag overengineering, redundant abstractions, and unused or unreachable code.",
  },
  {
    name: "clarity-reviewer",
    focus:
      "Code reviewer focused on naming and clarity. Flag misleading or ambiguous identifiers, inconsistent style, and confusing control flow.",
  },
  {
    name: "bugs-security-reviewer",
    focus:
      "Code reviewer focused on bug patterns and security. Flag missing input validation, race conditions, injection sinks, and unsafe defaults.",
  },
];

const DEFAULT_TIMEOUT_MS = 300_000;
const SEVERITIES: ReadonlyArray<ReviewFinding["severity"]> = [
  "critical",
  "major",
  "minor",
  "nit",
];

function resolveBinary(): { command: string; prefixArgs: string[] } {
  const override = process.env["CONSILIUM_BIN"];
  if (override && override.length > 0) {
    return { command: override, prefixArgs: [] };
  }
  const argv1 = process.argv[1];
  if (argv1 && argv1.length > 0) {
    return { command: process.execPath, prefixArgs: [argv1] };
  }
  return { command: "consilium", prefixArgs: [] };
}

function buildPrompt(reviewer: ReviewerSpec, edits: string): string {
  return [
    reviewer.focus,
    "",
    "Review the following diff. For each issue, emit a line in the format:",
    "[SEVERITY] path/to/file:LINE - short message",
    "Use SEVERITY one of CRITICAL, MAJOR, MINOR, NIT.",
    "Keep each message under 200 characters.",
    "",
    "=== DIFF ===",
    edits,
    "=== END DIFF ===",
  ].join("\n");
}

const FINDING_REGEX =
  /\[(critical|major|minor|nit)\]\s+(?:([^\s:]+?)(?::(\d+))?\s*[-—]\s*)?(.+)/i;

function parseFinding(
  reviewer: string,
  line: string,
): ReviewFinding | undefined {
  const trimmed = line.replace(/^[-*\d.)\s]+/, "").trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(FINDING_REGEX);
  if (!match) return undefined;
  const sev = match[1]!.toLowerCase() as ReviewFinding["severity"];
  if (!SEVERITIES.includes(sev)) return undefined;
  const file = match[2]?.trim() || undefined;
  const line_ = match[3] ? parseInt(match[3], 10) : undefined;
  const message = match[4]!.trim();
  if (!message) return undefined;
  return {
    reviewer,
    severity: sev,
    file,
    line: line_,
    message,
  };
}

function parseFindings(reviewer: string, output: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  let parsed: unknown = undefined;
  const trimmed = output.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parsed = undefined;
    }
  }
  let textBody = output;
  if (parsed && typeof parsed === "object") {
    const candidate = parsed as {
      synthesis?: unknown;
      finalSynthesis?: unknown;
      output?: unknown;
    };
    const synth =
      typeof candidate.synthesis === "string"
        ? candidate.synthesis
        : typeof candidate.finalSynthesis === "string"
          ? candidate.finalSynthesis
          : typeof candidate.output === "string"
            ? candidate.output
            : undefined;
    if (synth) textBody = synth;
  }

  for (const rawLine of textBody.split(/\r?\n/)) {
    const finding = parseFinding(reviewer, rawLine);
    if (finding) findings.push(finding);
  }
  return findings;
}

async function runReviewer(
  reviewer: ReviewerSpec,
  edits: string,
  timeoutMs: number,
  cwd: string,
): Promise<ReviewFinding[]> {
  const prompt = buildPrompt(reviewer, edits);
  const { command, prefixArgs } = resolveBinary();
  const args = [
    ...prefixArgs,
    "debate",
    prompt,
    "--mode",
    "quick",
    "--output-format",
    "json",
  ];

  return await new Promise<ReviewFinding[]>((resolve) => {
    const controller = new AbortController();
    let stdout = "";
    let timedOut = false;
    let settled = false;

    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      signal: controller.signal,
      env: { ...process.env, CONSILIUM_BG_AGENT: "1" },
    });

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      try {
        child.kill("SIGKILL");
      } catch {
        // best-effort
      }
      setImmediate(() => finalize([]));
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
    });
    child.stderr?.on("data", () => {
      /* swallow */
    });

    const finalize = (findings: ReviewFinding[]): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(findings);
    };

    child.on("error", () => {
      finalize([]);
    });
    child.on("close", () => {
      if (timedOut) {
        finalize([]);
        return;
      }
      finalize(parseFindings(reviewer.name, stdout));
    });
  });
}

function computeConsensus(findings: ReviewFinding[]): string[] {
  const SLICE = 50;
  const buckets = new Map<string, { reviewers: Set<string>; sample: string }>();
  for (const f of findings) {
    const key = f.message.slice(0, SLICE).toLowerCase().trim();
    if (!key) continue;
    let entry = buckets.get(key);
    if (!entry) {
      entry = { reviewers: new Set<string>(), sample: f.message };
      buckets.set(key, entry);
    }
    entry.reviewers.add(f.reviewer);
  }
  const consensus: string[] = [];
  for (const { reviewers, sample } of buckets.values()) {
    if (reviewers.size >= 2) consensus.push(sample);
  }
  return consensus;
}

export async function runSimplify(
  input: SimplifyInput,
): Promise<SimplifyResult> {
  const edits = (input.recentEdits ?? "").trim();
  if (!edits) {
    return { findings: [], consensusFixes: [] };
  }
  const requested = input.reviewerCount ?? DEFAULT_REVIEWERS.length;
  const count = Math.max(1, Math.min(requested, DEFAULT_REVIEWERS.length));
  const reviewers = DEFAULT_REVIEWERS.slice(0, count);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cwd = input.cwd ?? process.cwd();

  const perReviewer = await Promise.all(
    reviewers.map((r) => runReviewer(r, edits, timeoutMs, cwd)),
  );

  const findings = perReviewer.flat();
  const consensusFixes = computeConsensus(findings);
  return { findings, consensusFixes };
}
