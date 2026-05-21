export type DebateMode =
  | "quick"
  | "council"
  | "deep"
  | "blind"
  | "redteam"
  | "jury"
  | "market"
  | "auto";

export interface DebateModeConfig {
  rounds: number;
  subAgents: boolean;
  estimatedCost: number;
  description: string;
  estimatedTime: string;
}

export const DEBATE_MODES: Record<DebateMode, DebateModeConfig> = {
  quick: {
    rounds: 1,
    subAgents: false,
    estimatedCost: 0.01,
    description: "Single round, fastest response",
    estimatedTime: "~15s",
  },
  council: {
    rounds: 3,
    subAgents: false,
    estimatedCost: 0.04,
    description: "Multi-round deliberation",
    estimatedTime: "~45s",
  },
  deep: {
    rounds: 5,
    subAgents: true,
    estimatedCost: 0.08,
    description: "Multi-round with sub-agent research",
    estimatedTime: "~90s",
  },
  blind: {
    rounds: 3,
    subAgents: false,
    estimatedCost: 0.04,
    description: "Names hidden until scored",
    estimatedTime: "~45s",
  },
  redteam: {
    rounds: 4,
    subAgents: true,
    estimatedCost: 0.1,
    description: "Adversarial red team assessment",
    estimatedTime: "~120s",
  },
  jury: {
    rounds: 3,
    subAgents: false,
    estimatedCost: 0.05,
    description: "Panel deliberation with voting",
    estimatedTime: "~60s",
  },
  market: {
    rounds: 5,
    subAgents: true,
    estimatedCost: 0.09,
    description: "Prediction market confidence aggregation",
    estimatedTime: "~90s",
  },
  auto: {
    rounds: 3,
    subAgents: false,
    estimatedCost: 0.04,
    description: "Automatically selects best mode",
    estimatedTime: "~45s",
  },
};

export const ALL_MODES = Object.keys(DEBATE_MODES) as DebateMode[];

export function isValidMode(mode: string): mode is DebateMode {
  return mode in DEBATE_MODES;
}

export function getDefaultMode(): DebateMode {
  return "auto";
}
