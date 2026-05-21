export type { DebateMode, DebateModeConfig } from "@consilium/shared";
export {
  DEBATE_MODES,
  ALL_MODES,
  isValidMode,
  getDefaultMode,
} from "@consilium/shared";
import type { DebateMode } from "@consilium/shared";
import { DEBATE_MODES } from "@consilium/shared";

export interface CostEstimate {
  total: number;
  breakdown: {
    perRound: number;
    judge: number;
    subAgents?: number;
  };
  estimatedTime: string;
}

function baseMinutesForModeEstimate(config: {
  subAgents: boolean;
  rounds: number;
}): number {
  if (config.subAgents) return 1.5;
  if (config.rounds === 1) return 0.25;
  return 0.75;
}

export function estimateCost(
  mode: DebateMode,
  modelCount: number,
): CostEstimate {
  const config = DEBATE_MODES[mode];
  const baseCostPerModel = config.estimatedCost / 3;
  const perRound = baseCostPerModel * modelCount;
  const judge = perRound * 0.5;
  const subAgents = config.subAgents ? perRound * modelCount * 0.3 : undefined;

  const total = perRound * config.rounds + judge + (subAgents ?? 0);

  const timeMultiplier = modelCount / 3;
  const baseMinutes = baseMinutesForModeEstimate(config);
  const minutes = Math.ceil(baseMinutes * timeMultiplier * 60);

  return {
    total: Math.round(total * 1000) / 1000,
    breakdown: {
      perRound: Math.round(perRound * 1000) / 1000,
      judge: Math.round(judge * 1000) / 1000,
      ...(subAgents !== undefined && {
        subAgents: Math.round(subAgents * 1000) / 1000,
      }),
    },
    estimatedTime: `~${minutes}s`,
  };
}

export function formatCostEstimate(estimate: CostEstimate): string {
  const lines = [
    `Estimated cost: $${estimate.total.toFixed(3)}`,
    `  Per round:    $${estimate.breakdown.perRound.toFixed(3)}`,
    `  Judge:        $${estimate.breakdown.judge.toFixed(3)}`,
  ];

  if (estimate.breakdown.subAgents !== undefined) {
    lines.push(`  Sub-agents:   $${estimate.breakdown.subAgents.toFixed(3)}`);
  }

  lines.push(`  Time:         ${estimate.estimatedTime}`);

  return lines.join("\n");
}
