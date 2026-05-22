import { ConsiliumClient } from "../api/client";
import type { DebateEvent, DebateOptions } from "../api/client";
import { getCurrentBranch, getGitDiff } from "./git-context";

export interface ReviewIssue {
  severity: "critical" | "major" | "minor";
  file?: string;
  line?: number;
  comment: string;
  suggestion?: string;
}

export interface UltraReviewResult {
  issues: ReviewIssue[];
  overallAssessment: string;
  markdown: string;
  blocked: boolean;
}

export interface UltraReviewOptions {
  diff?: string;
  branch?: string;
  mode?: string;
  models?: string[];
  client?: ConsiliumClient;
  diffProvider?: () => string | null;
}

const ULTRA_REVIEW_SYSTEM_PROMPT = `You are an adversarial code review council. Each issue must be a separate Markdown bullet using EXACTLY this single-line shape, in priority order:

- [CRITICAL|MAJOR|MINOR] path/to/file.ext:LINE - <one-sentence problem> :: Suggestion: <one-sentence fix>

Rules:
- One bullet per issue. Use uppercase severity in square brackets.
- Use the closest line number (an integer). If unknown, use 0.
- Use ":: Suggestion:" only when a fix is concrete; omit the suggestion clause otherwise.
- After all bullets, add a final paragraph beginning with "Overall:" giving a one-line verdict.
- Be specific: cite real symbols, files, and patterns from the diff.
- Critical = security, data-loss, broken builds, or correctness bugs.
- Major = regressions, missing tests for risky paths, API contract drift.
- Minor = style, naming, doc gaps, low-risk smells.`;

const ISSUE_LINE_RE =
  /^\s*[-*]\s*\[(CRITICAL|MAJOR|MINOR)\]\s+([^\s:]+)?(?::(\d+))?\s*(?:-|—|–)\s*(.+?)(?:\s*::\s*Suggestion\s*:\s*(.+))?\s*$/i;
const OVERALL_LINE_RE = /^\s*Overall\s*:\s*(.+)$/i;

function severityFrom(raw: string): ReviewIssue["severity"] {
  const lower = raw.toLowerCase();
  if (lower === "critical") return "critical";
  if (lower === "major") return "major";
  return "minor";
}

export function parseReviewFromSynthesis(synthesis: string): {
  issues: ReviewIssue[];
  overallAssessment: string;
} {
  const lines = synthesis.split(/\r?\n/);
  const issues: ReviewIssue[] = [];
  let overallAssessment = "";

  for (const raw of lines) {
    const match = ISSUE_LINE_RE.exec(raw);
    if (match) {
      const severity = severityFrom(match[1] ?? "");
      const file = match[2]?.trim();
      const lineNumber = match[3] ? Number.parseInt(match[3], 10) : undefined;
      const comment = (match[4] ?? "").trim();
      const suggestion = match[5]?.trim();
      if (!comment) continue;
      const issue: ReviewIssue = { severity, comment };
      if (file && file !== "-") issue.file = file;
      if (lineNumber !== undefined && lineNumber > 0) issue.line = lineNumber;
      if (suggestion) issue.suggestion = suggestion;
      issues.push(issue);
      continue;
    }
    const overall = OVERALL_LINE_RE.exec(raw);
    if (overall && overall[1]) {
      overallAssessment = overall[1].trim();
    }
  }

  if (!overallAssessment) {
    const trimmed = synthesis.trim().split(/\n\n+/).pop()?.trim() ?? "";
    overallAssessment = trimmed.replace(/^Overall\s*:\s*/i, "").slice(0, 500);
  }

  return { issues, overallAssessment };
}

function severityRank(s: ReviewIssue["severity"]): number {
  if (s === "critical") return 0;
  if (s === "major") return 1;
  return 2;
}

export function buildReviewMarkdown(
  issues: ReviewIssue[],
  overallAssessment: string,
  blocked: boolean,
  context: { branch?: string },
): string {
  const sections: string[] = [];
  sections.push("# UltraReview");
  sections.push("");
  if (context.branch) {
    sections.push(`**Branch:** \`${context.branch}\``);
    sections.push("");
  }
  sections.push(
    `**Status:** ${blocked ? "BLOCKED - critical issues present" : "Advisory"}`,
  );
  sections.push("");

  const sorted = [...issues].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity),
  );
  const groups: Array<["critical" | "major" | "minor", string]> = [
    ["critical", "Critical"],
    ["major", "Major"],
    ["minor", "Minor"],
  ];

  for (const [severity, label] of groups) {
    const group = sorted.filter((i) => i.severity === severity);
    if (group.length === 0) continue;
    sections.push(`## ${label} (${group.length})`);
    sections.push("");
    for (const issue of group) {
      const locationParts: string[] = [];
      if (issue.file) locationParts.push(`\`${issue.file}\``);
      if (issue.line !== undefined) locationParts.push(`L${issue.line}`);
      const location =
        locationParts.length > 0 ? ` (${locationParts.join(":")})` : "";
      sections.push(`- ${issue.comment}${location}`);
      if (issue.suggestion) {
        sections.push(`  - Suggestion: ${issue.suggestion}`);
      }
    }
    sections.push("");
  }

  if (issues.length === 0) {
    sections.push("## No issues flagged");
    sections.push("");
    sections.push("The reviewers did not surface any concrete concerns.");
    sections.push("");
  }

  sections.push("## Overall");
  sections.push("");
  sections.push(overallAssessment || "No overall assessment provided.");
  sections.push("");

  return sections.join("\n");
}

async function runDebateCapture(
  client: ConsiliumClient,
  opts: DebateOptions,
): Promise<string> {
  const { id } = await client.createDebate(opts);
  let synthesisFinal = "";
  let buffer = "";
  await client.streamDebate(id, (event: DebateEvent) => {
    if (!event) return;
    if (event.type === "consensus" && event.text) {
      synthesisFinal = event.text;
      return;
    }
    if (event.type === "agent_chunk" && event.text) {
      buffer += event.text;
    }
  });
  return synthesisFinal || buffer;
}

export async function runUltraReview(
  opts: UltraReviewOptions = {},
): Promise<UltraReviewResult> {
  const client = opts.client ?? new ConsiliumClient();
  const mode = (opts.mode ?? "redteam") as DebateOptions["mode"];
  const branch = opts.branch ?? getCurrentBranch() ?? undefined;

  const providedDiff = opts.diff?.trim();
  const diff =
    providedDiff && providedDiff.length > 0
      ? providedDiff
      : ((opts.diffProvider ? opts.diffProvider() : getGitDiff()) ?? "");

  if (!diff.trim()) {
    const emptyMarkdown = buildReviewMarkdown(
      [],
      "No diff was available to review.",
      false,
      { branch },
    );
    return {
      issues: [],
      overallAssessment: "No diff was available to review.",
      markdown: emptyMarkdown,
      blocked: false,
    };
  }

  const truncated =
    diff.length > 60000
      ? diff.slice(0, 60000) + "\n... (diff truncated)"
      : diff;
  const debateTopic = [
    ULTRA_REVIEW_SYSTEM_PROMPT,
    "",
    branch ? `Branch under review: ${branch}` : undefined,
    "",
    "--- DIFF ---",
    truncated,
  ]
    .filter((s): s is string => typeof s === "string")
    .join("\n");

  const synthesis = await runDebateCapture(client, {
    topic: debateTopic,
    mode,
    models: opts.models,
    debateSource: "cli",
  });

  const { issues, overallAssessment } = parseReviewFromSynthesis(synthesis);
  const blocked = issues.some((i) => i.severity === "critical");
  const markdown = buildReviewMarkdown(issues, overallAssessment, blocked, {
    branch,
  });

  return { issues, overallAssessment, markdown, blocked };
}
