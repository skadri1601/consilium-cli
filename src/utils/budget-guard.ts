export interface BudgetSummary {
  totalUsd: number;
  turns: number;
}

export interface AbortDecision {
  abort: boolean;
  reason?: string;
}

export class BudgetGuard {
  private readonly maxBudgetUsd?: number;
  private readonly maxTurns?: number;
  private totalUsd = 0;
  private turns = 0;

  constructor(maxBudgetUsd?: number, maxTurns?: number) {
    this.maxBudgetUsd =
      typeof maxBudgetUsd === "number" && maxBudgetUsd > 0
        ? maxBudgetUsd
        : undefined;
    this.maxTurns =
      typeof maxTurns === "number" && maxTurns > 0
        ? Math.floor(maxTurns)
        : undefined;
  }

  recordTurnCost(usd: number): void {
    if (!Number.isFinite(usd) || usd <= 0) return;
    this.totalUsd += usd;
  }

  recordTurn(): void {
    this.turns += 1;
  }

  shouldAbort(): AbortDecision {
    if (this.maxBudgetUsd !== undefined && this.totalUsd >= this.maxBudgetUsd) {
      return {
        abort: true,
        reason:
          `Budget exceeded: spent $${this.totalUsd.toFixed(4)} of ` +
          `$${this.maxBudgetUsd.toFixed(4)} cap`,
      };
    }
    if (this.maxTurns !== undefined && this.turns >= this.maxTurns) {
      return {
        abort: true,
        reason: `Turn limit reached: ${this.turns} of ${this.maxTurns} turn cap`,
      };
    }
    return { abort: false };
  }

  summary(): BudgetSummary {
    return { totalUsd: this.totalUsd, turns: this.turns };
  }

  hasBudgetLimit(): boolean {
    return this.maxBudgetUsd !== undefined;
  }

  hasTurnLimit(): boolean {
    return this.maxTurns !== undefined;
  }
}
