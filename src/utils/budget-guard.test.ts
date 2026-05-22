import { describe, expect, it } from "vitest";
import { BudgetGuard } from "./budget-guard";

describe("BudgetGuard", () => {
  it("does not abort when no limits set", () => {
    const guard = new BudgetGuard();
    guard.recordTurnCost(100);
    guard.recordTurn();
    expect(guard.shouldAbort().abort).toBe(false);
    expect(guard.hasBudgetLimit()).toBe(false);
    expect(guard.hasTurnLimit()).toBe(false);
  });

  it("aborts when total cost meets the budget cap", () => {
    const guard = new BudgetGuard(1.0);
    guard.recordTurnCost(0.4);
    expect(guard.shouldAbort().abort).toBe(false);
    guard.recordTurnCost(0.7);
    const decision = guard.shouldAbort();
    expect(decision.abort).toBe(true);
    expect(decision.reason).toMatch(/Budget exceeded/);
    expect(decision.reason).toContain("$1.0000");
  });

  it("aborts when turn count meets the cap", () => {
    const guard = new BudgetGuard(undefined, 3);
    guard.recordTurn();
    guard.recordTurn();
    expect(guard.shouldAbort().abort).toBe(false);
    guard.recordTurn();
    const decision = guard.shouldAbort();
    expect(decision.abort).toBe(true);
    expect(decision.reason).toMatch(/Turn limit/);
  });

  it("ignores zero and negative turn costs", () => {
    const guard = new BudgetGuard(1.0);
    guard.recordTurnCost(-5);
    guard.recordTurnCost(0);
    guard.recordTurnCost(Number.NaN);
    expect(guard.summary().totalUsd).toBe(0);
    expect(guard.shouldAbort().abort).toBe(false);
  });

  it("treats non-positive caps as no cap", () => {
    const guard = new BudgetGuard(0, 0);
    guard.recordTurnCost(99);
    guard.recordTurn();
    expect(guard.shouldAbort().abort).toBe(false);
    expect(guard.hasBudgetLimit()).toBe(false);
    expect(guard.hasTurnLimit()).toBe(false);
  });

  it("summary reports accurate totals", () => {
    const guard = new BudgetGuard(10, 5);
    guard.recordTurnCost(1.5);
    guard.recordTurnCost(2.25);
    guard.recordTurn();
    guard.recordTurn();
    expect(guard.summary()).toEqual({ totalUsd: 3.75, turns: 2 });
  });

  it("floors fractional max turns", () => {
    const guard = new BudgetGuard(undefined, 2.9);
    guard.recordTurn();
    expect(guard.shouldAbort().abort).toBe(false);
    guard.recordTurn();
    expect(guard.shouldAbort().abort).toBe(true);
  });
});
