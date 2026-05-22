import fs from "node:fs";
import path from "node:path";
import { ConsiliumClient } from "../api/client";
import type { DebateEvent, DebateOptions } from "../api/client";
import { resolveProjectRoot } from "./project-root";

export interface PlanStep {
  id: number;
  title: string;
  description: string;
  filesToTouch: string[];
  estimatedEffort: "minutes" | "hours" | "days";
}

export interface UltraPlanResult {
  topic: string;
  steps: PlanStep[];
  risks: string[];
  outOfScope: string[];
  markdown: string;
  savedTo?: string;
}

export interface UltraPlanOptions {
  topic: string;
  mode?: string;
  models?: string[];
  save?: boolean;
  client?: ConsiliumClient;
  outputDir?: string;
  today?: Date;
}

const ULTRA_PLAN_SYSTEM_PROMPT = `You are part of an expert planning council producing an implementation plan.

For the user-provided topic, produce a numbered plan using GitHub Markdown. Structure:

### Task 1: <short title>
<paragraph describing the change>
**Files:** path/to/file.ts, path/to/other.ts
**Effort:** minutes | hours | days

(Repeat numbered Task sections; aim for 4-10 tasks.)

### Risks
- Bullet of each risk

### Out of Scope
- Bullet of each explicit non-goal

Rules:
- Each Task heading must use the exact form "### Task N: title".
- Always include the Files line (even if empty as "Files: -").
- Always include an Effort line with one of minutes|hours|days.
- Keep prose concrete; reference real file paths and modules when possible.
- Do not add commentary outside the structure above.`;

const TASK_HEADING_RE = /^###\s+(?:Task|Step)\s+(\d+)\s*:\s*(.+?)\s*$/i;
const NUMBERED_LINE_RE = /^(\d+)\.\s+(.+)$/;
const FILES_LINE_RE = /^\s*(?:\*{0,2}Files\*{0,2}|Files):\s*(.+)$/i;
const EFFORT_LINE_RE =
  /^\s*(?:\*{0,2}Effort\*{0,2}|Effort):\s*(minutes|hours|days)/i;

export function slugify(topic: string): string {
  return (
    topic
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 80) || "plan"
  );
}

function formatDateYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseFiles(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed || trimmed === "-" || trimmed.toLowerCase() === "none") {
    return [];
  }
  return trimmed
    .split(/[,;]+/)
    .map((s) => s.replace(/^[`*\s-]+|[`*\s]+$/g, ""))
    .filter((s) => s.length > 0);
}

function parseEffort(value: string): PlanStep["estimatedEffort"] {
  const lower = value.toLowerCase();
  if (lower.startsWith("min")) return "minutes";
  if (lower.startsWith("day")) return "days";
  return "hours";
}

function parseTaskBlock(id: number, title: string, body: string[]): PlanStep {
  let description = "";
  let filesToTouch: string[] = [];
  let estimatedEffort: PlanStep["estimatedEffort"] = "hours";

  const descLines: string[] = [];
  for (const raw of body) {
    const line = raw.trim();
    const filesMatch = FILES_LINE_RE.exec(line);
    if (filesMatch && filesMatch[1]) {
      filesToTouch = parseFiles(filesMatch[1]);
      continue;
    }
    const effortMatch = EFFORT_LINE_RE.exec(line);
    if (effortMatch && effortMatch[1]) {
      estimatedEffort = parseEffort(effortMatch[1]);
      continue;
    }
    if (line) descLines.push(line);
  }
  description = descLines.join(" ").replace(/\s+/g, " ").trim();

  return { id, title, description, filesToTouch, estimatedEffort };
}

export function parsePlanFromSynthesis(synthesis: string): {
  steps: PlanStep[];
  risks: string[];
  outOfScope: string[];
} {
  const lines = synthesis.split(/\r?\n/);
  const steps: PlanStep[] = [];
  const risks: string[] = [];
  const outOfScope: string[] = [];

  type Section = "task" | "risks" | "outOfScope" | "none";
  let section: Section = "none";
  let currentId = 0;
  let currentTitle = "";
  let buffer: string[] = [];

  const flushTask = (): void => {
    if (currentId > 0) {
      steps.push(parseTaskBlock(currentId, currentTitle, buffer));
    }
    currentId = 0;
    currentTitle = "";
    buffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/ /g, " ");
    const taskMatch = TASK_HEADING_RE.exec(line.trim());
    if (taskMatch && taskMatch[1] && taskMatch[2]) {
      flushTask();
      currentId = Number.parseInt(taskMatch[1], 10);
      currentTitle = taskMatch[2].trim();
      section = "task";
      continue;
    }

    const headingMatch = /^#{2,4}\s+(.+?)\s*$/.exec(line.trim());
    if (headingMatch && headingMatch[1]) {
      flushTask();
      const heading = headingMatch[1].toLowerCase();
      if (heading.includes("risk")) {
        section = "risks";
      } else if (
        heading.includes("out of scope") ||
        heading.includes("non-goal") ||
        heading.includes("not in scope")
      ) {
        section = "outOfScope";
      } else {
        section = "none";
      }
      continue;
    }

    if (section === "task") {
      buffer.push(line);
      continue;
    }

    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    const numbered = NUMBERED_LINE_RE.exec(line.trim());
    const item = bullet?.[1] ?? numbered?.[2];
    if (item) {
      if (section === "risks") risks.push(item.trim());
      else if (section === "outOfScope") outOfScope.push(item.trim());
    }
  }

  flushTask();

  if (steps.length === 0) {
    const fallback = extractFallbackSteps(synthesis);
    steps.push(...fallback);
  }

  return { steps, risks, outOfScope };
}

function extractFallbackSteps(synthesis: string): PlanStep[] {
  const lines = synthesis.split(/\r?\n/);
  const steps: PlanStep[] = [];
  for (const raw of lines) {
    const m = NUMBERED_LINE_RE.exec(raw.trim());
    if (m && m[1] && m[2]) {
      steps.push({
        id: Number.parseInt(m[1], 10),
        title: m[2].slice(0, 120),
        description: m[2],
        filesToTouch: [],
        estimatedEffort: "hours",
      });
    }
  }
  return steps;
}

export function buildPlanMarkdown(
  topic: string,
  steps: PlanStep[],
  risks: string[],
  outOfScope: string[],
): string {
  const sections: string[] = [];
  sections.push(`# ${topic}`);
  sections.push("");
  sections.push(
    "> Generated by `/ultraplan` - multi-agent plan derived from a Consilium debate.",
  );
  sections.push("");
  sections.push(`**Goal:** ${topic}`);
  sections.push("");
  sections.push("## File Map");
  sections.push("");
  sections.push("| Task | Files | Effort |");
  sections.push("|------|-------|--------|");
  for (const step of steps) {
    const files =
      step.filesToTouch.length > 0
        ? step.filesToTouch.map((f) => `\`${f}\``).join(", ")
        : "-";
    sections.push(
      `| ${step.id}. ${step.title} | ${files} | ${step.estimatedEffort} |`,
    );
  }
  sections.push("");

  for (const step of steps) {
    sections.push(`### Task ${step.id}: ${step.title}`);
    sections.push("");
    if (step.description) {
      sections.push(step.description);
      sections.push("");
    }
    if (step.filesToTouch.length > 0) {
      sections.push("**Files:**");
      for (const f of step.filesToTouch) sections.push(`- \`${f}\``);
      sections.push("");
    }
    sections.push(`**Effort:** ${step.estimatedEffort}`);
    sections.push("");
  }

  sections.push("## Risks");
  sections.push("");
  if (risks.length === 0) {
    sections.push("- None recorded.");
  } else {
    for (const r of risks) sections.push(`- ${r}`);
  }
  sections.push("");
  sections.push("## Out of Scope");
  sections.push("");
  if (outOfScope.length === 0) {
    sections.push("- None recorded.");
  } else {
    for (const o of outOfScope) sections.push(`- ${o}`);
  }
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

export async function runUltraPlan(
  opts: UltraPlanOptions,
): Promise<UltraPlanResult> {
  const topic = opts.topic.trim();
  if (!topic) {
    throw new Error("topic is required");
  }
  const client = opts.client ?? new ConsiliumClient();
  const mode = (opts.mode ?? "council") as DebateOptions["mode"];
  const debateTopic = `${ULTRA_PLAN_SYSTEM_PROMPT}\n\n--- USER TOPIC ---\n${topic}`;

  const synthesis = await runDebateCapture(client, {
    topic: debateTopic,
    mode,
    models: opts.models,
    debateSource: "cli",
  });

  const { steps, risks, outOfScope } = parsePlanFromSynthesis(synthesis);
  const markdown = buildPlanMarkdown(topic, steps, risks, outOfScope);

  let savedTo: string | undefined;
  if (opts.save) {
    const baseDir =
      opts.outputDir ??
      path.join(
        resolveProjectRoot(process.cwd()).root,
        "docs",
        "superpowers",
        "plans",
      );
    const date = formatDateYmd(opts.today ?? new Date());
    const filename = `${date}-${slugify(topic)}.md`;
    const targetPath = path.join(baseDir, filename);
    fs.mkdirSync(baseDir, { recursive: true });
    fs.writeFileSync(targetPath, markdown, "utf-8");
    savedTo = targetPath;
  }

  return { topic, steps, risks, outOfScope, markdown, savedTo };
}
