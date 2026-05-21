import type { DebateMode } from "@consilium/shared";

export type JudgePhase = 1 | 2 | 3 | 4 | 5;

export interface RubricWeight {
  dimension: string;
  weight: number;
  description: string;
  anchors: Record<number, string>;
}

export interface JudgeConfig {
  source: "cli" | "web";
  priorities: string[];
  phase5Prompt: string;
  rubric: RubricWeight[];
}

const DEFAULT_RUBRIC: RubricWeight[] = [
  {
    dimension: "correctness",
    weight: 0.3,
    description: "Factual accuracy and logical validity",
    anchors: { 1: "Major errors", 5: "Mostly correct", 10: "Flawless" },
  },
  {
    dimension: "reasoning_quality",
    weight: 0.25,
    description: "Depth and rigor of reasoning",
    anchors: { 1: "No reasoning", 5: "Basic", 10: "Rigorous multi-step" },
  },
  {
    dimension: "completeness",
    weight: 0.2,
    description: "Covers all aspects",
    anchors: { 1: "Misses key points", 5: "Adequate", 10: "Comprehensive" },
  },
  {
    dimension: "actionability",
    weight: 0.15,
    description: "Practical applicability",
    anchors: {
      1: "Abstract only",
      5: "Some actionable",
      10: "Immediately usable",
    },
  },
  {
    dimension: "conciseness",
    weight: 0.1,
    description: "Information density",
    anchors: { 1: "Extreme padding", 5: "Reasonable", 10: "Zero waste" },
  },
];

const DEFAULT_PRIORITIES = [
  "code_correctness",
  "project_relevance",
  "implementation_feasibility",
  "codebase_compatibility",
  "maintainability",
  "security",
];

const MODE_PRIORITY_OVERRIDES: Partial<Record<DebateMode, string[]>> = {
  redteam: [
    "security",
    "code_correctness",
    "codebase_compatibility",
    "implementation_feasibility",
    "project_relevance",
    "maintainability",
  ],
  council: [
    "consensus_strength",
    "code_correctness",
    "project_relevance",
    "implementation_feasibility",
    "codebase_compatibility",
    "maintainability",
  ],
  blind: [
    "objectivity",
    "code_correctness",
    "reasoning_quality",
    "implementation_feasibility",
    "project_relevance",
    "maintainability",
  ],
  jury: [
    "consensus_strength",
    "evidence_quality",
    "code_correctness",
    "project_relevance",
    "implementation_feasibility",
    "maintainability",
  ],
  market: [
    "confidence_calibration",
    "code_correctness",
    "evidence_quality",
    "project_relevance",
    "implementation_feasibility",
    "maintainability",
  ],
};

const MODE_RUBRIC_OVERRIDES: Partial<Record<DebateMode, RubricWeight[]>> = {
  redteam: [
    {
      dimension: "correctness",
      weight: 0.25,
      description: "Factual accuracy and logical validity",
      anchors: { 1: "Major errors", 5: "Mostly correct", 10: "Flawless" },
    },
    {
      dimension: "reasoning_quality",
      weight: 0.2,
      description: "Depth and rigor of reasoning",
      anchors: { 1: "No reasoning", 5: "Basic", 10: "Rigorous multi-step" },
    },
    {
      dimension: "completeness",
      weight: 0.15,
      description: "Covers all aspects",
      anchors: { 1: "Misses key points", 5: "Adequate", 10: "Comprehensive" },
    },
    {
      dimension: "actionability",
      weight: 0.1,
      description: "Practical applicability",
      anchors: {
        1: "Abstract only",
        5: "Some actionable",
        10: "Immediately usable",
      },
    },
    {
      dimension: "security_rigor",
      weight: 0.3,
      description: "Thoroughness of security analysis",
      anchors: {
        1: "Surface level",
        5: "Common vectors",
        10: "Comprehensive threat model",
      },
    },
  ],
  blind: [
    {
      dimension: "correctness",
      weight: 0.3,
      description: "Factual accuracy and logical validity",
      anchors: { 1: "Major errors", 5: "Mostly correct", 10: "Flawless" },
    },
    {
      dimension: "reasoning_quality",
      weight: 0.3,
      description: "Depth and rigor of reasoning",
      anchors: { 1: "No reasoning", 5: "Basic", 10: "Rigorous multi-step" },
    },
    {
      dimension: "completeness",
      weight: 0.2,
      description: "Covers all aspects",
      anchors: { 1: "Misses key points", 5: "Adequate", 10: "Comprehensive" },
    },
    {
      dimension: "actionability",
      weight: 0.1,
      description: "Practical applicability",
      anchors: {
        1: "Abstract only",
        5: "Some actionable",
        10: "Immediately usable",
      },
    },
    {
      dimension: "conciseness",
      weight: 0.1,
      description: "Information density",
      anchors: { 1: "Extreme padding", 5: "Reasonable", 10: "Zero waste" },
    },
  ],
};

const DEFAULT_PHASE5_PROMPT = `You are synthesizing a multi-agent debate for a CLI user working on a codebase.

PRIORITIES (in order):
1. CODE CORRECTNESS - Does the code compile/run? Are there bugs?
2. PROJECT RELEVANCE - Does the solution fit THIS specific project's stack, patterns, and conventions?
3. IMPLEMENTATION FEASIBILITY - Can a developer implement this now with the current codebase?
4. CODEBASE COMPATIBILITY - Does it work with existing dependencies, APIs, and architecture?
5. MAINTAINABILITY - Is it maintainable by the team? Clear naming, reasonable complexity?
6. SECURITY - Are there vulnerabilities? SQL injection, XSS, secrets exposure?

RULES:
- Working code > elegant code
- Concrete implementations > abstract advice
- If agents provide code, synthesize the BEST working version
- Include file paths and line numbers when referencing code
- Flag any security concerns explicitly
- If a ProjectContext is provided, ensure recommendations are compatible with the detected stack

{projectContext}

Synthesize the debate into a clear, actionable response.`;

const MODE_PHASE5_PROMPTS: Partial<Record<DebateMode, string>> = {
  redteam: `You are synthesizing an adversarial red team assessment for a CLI user.

PRIORITIES (in order):
1. SECURITY - Identify all vulnerabilities, attack vectors, and threat surfaces
2. CODE CORRECTNESS - Does the code have exploitable bugs or logic errors?
3. CODEBASE COMPATIBILITY - Could fixes break existing architecture?
4. IMPLEMENTATION FEASIBILITY - Are mitigations practical to implement now?
5. PROJECT RELEVANCE - Do recommendations fit the project's threat model?
6. MAINTAINABILITY - Are security fixes sustainable long-term?

RULES:
- Security concerns > all other considerations
- Classify vulnerabilities by severity (Critical/High/Medium/Low)
- Provide concrete remediation steps with code examples
- Flag any secrets, injection points, or auth bypasses explicitly
- Include CVE references where applicable

{projectContext}

Synthesize the red team findings into a prioritized security report with actionable fixes.`,

  council: `You are synthesizing a multi-agent council deliberation for a CLI user.

PRIORITIES (in order):
1. CONSENSUS STRENGTH - Where do agents agree? Weight consensus heavily
2. CODE CORRECTNESS - Does the agreed-upon approach work?
3. PROJECT RELEVANCE - Does the consensus fit the project's patterns?
4. IMPLEMENTATION FEASIBILITY - Can the team implement the consensus now?
5. CODEBASE COMPATIBILITY - Does it integrate with existing systems?
6. MAINTAINABILITY - Is the consensus solution maintainable?

RULES:
- Highlight areas of strong agreement first
- Note significant dissent and explain why it was outweighed
- Working consensus > individual brilliance
- Concrete implementations > abstract agreement
- Include file paths and line numbers when referencing code

{projectContext}

Synthesize the council deliberation into a consensus-driven response.`,

  blind: `You are synthesizing a blind evaluation for a CLI user. Agent identities were hidden during scoring.

PRIORITIES (in order):
1. OBJECTIVITY - Judge purely on argument quality, not source
2. CODE CORRECTNESS - Does the code compile/run? Are there bugs?
3. REASONING QUALITY - Depth and rigor of the reasoning presented
4. IMPLEMENTATION FEASIBILITY - Can a developer implement this now?
5. PROJECT RELEVANCE - Does the solution fit the project?
6. MAINTAINABILITY - Is it maintainable by the team?

RULES:
- Evaluate arguments on merit alone
- Do not reference agent names or models in synthesis
- Strongest reasoning > most popular position
- Concrete implementations > abstract advice
- Include file paths and line numbers when referencing code

{projectContext}

Synthesize the blind evaluation into an objective, merit-based response.`,

  jury: `You are synthesizing a jury panel deliberation for a CLI user.

PRIORITIES (in order):
1. CONSENSUS STRENGTH - What did the jury agree on?
2. EVIDENCE QUALITY - Which positions had the strongest supporting evidence?
3. CODE CORRECTNESS - Does the verdict hold technically?
4. PROJECT RELEVANCE - Does the verdict fit the project?
5. IMPLEMENTATION FEASIBILITY - Can the verdict be implemented?
6. MAINTAINABILITY - Is the solution maintainable?

RULES:
- Present the jury's verdict clearly
- Include the vote breakdown
- Note minority opinions with their reasoning
- Concrete implementations > abstract verdicts

{projectContext}

Synthesize the jury deliberation into a clear verdict with implementation guidance.`,

  market: `You are synthesizing a prediction market aggregation for a CLI user.

PRIORITIES (in order):
1. CONFIDENCE CALIBRATION - Weight positions by calibrated confidence scores
2. CODE CORRECTNESS - Does the highest-confidence approach work?
3. EVIDENCE QUALITY - What evidence supports the confident positions?
4. PROJECT RELEVANCE - Does the favored approach fit the project?
5. IMPLEMENTATION FEASIBILITY - Can the market winner be implemented?
6. MAINTAINABILITY - Is the favored solution maintainable?

RULES:
- Report confidence-weighted consensus
- Flag positions where confidence diverges sharply
- High confidence + evidence > low confidence consensus
- Include the confidence distribution
- Concrete implementations > abstract predictions

{projectContext}

Synthesize the market positions into a confidence-weighted recommendation.`,
};

export const CLI_JUDGE_CONFIG = {
  source: "cli" as const,
  priorities: [...DEFAULT_PRIORITIES],
  phase5Emphasis: "working code > elegant code",
};

export const CLI_JUDGE_PHASE5_PROMPT = DEFAULT_PHASE5_PROMPT;

export const WEB_JUDGE_PRIORITIES = [
  "logical_reasoning",
  "evidence_quality",
  "completeness",
  "real_world_applicability",
  "nuance",
] as const;

const WEB_JUDGE_CONFIG = {
  source: "web" as const,
  priorities: [...WEB_JUDGE_PRIORITIES],
};

export function buildJudgePayload(
  projectContext?: any,
  mode?: DebateMode,
): object {
  const config = getJudgeConfig(mode || "auto");
  const phase5Prompt = projectContext
    ? config.phase5Prompt.replace(
        "{projectContext}",
        `ProjectContext:\n${JSON.stringify(projectContext, null, 2)}`,
      )
    : config.phase5Prompt.replace("{projectContext}", "");

  return {
    judgeConfig: {
      source: config.source,
      priorities: [...config.priorities],
      phase5Prompt,
      rubric: config.rubric,
    },
  };
}

export function getJudgeConfig(source: "cli" | "web"): JudgeConfig;
export function getJudgeConfig(mode: DebateMode): JudgeConfig;
export function getJudgeConfig(modeOrSource: string): JudgeConfig {
  if (modeOrSource === "web") {
    return {
      source: "web",
      priorities: [...WEB_JUDGE_PRIORITIES],
      phase5Prompt: DEFAULT_PHASE5_PROMPT,
      rubric: [...DEFAULT_RUBRIC],
    };
  }

  const mode = (modeOrSource === "cli" ? "auto" : modeOrSource) as DebateMode;
  const priorities = MODE_PRIORITY_OVERRIDES[mode] || [...DEFAULT_PRIORITIES];
  const rubric = MODE_RUBRIC_OVERRIDES[mode] || [...DEFAULT_RUBRIC];
  const phase5Prompt = MODE_PHASE5_PROMPTS[mode] || DEFAULT_PHASE5_PROMPT;

  return {
    source: "cli",
    priorities: [...priorities],
    phase5Prompt,
    rubric: [...rubric],
  };
}
