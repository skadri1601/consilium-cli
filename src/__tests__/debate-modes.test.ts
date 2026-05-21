import { describe, it, expect } from "vitest";
import {
  ALL_MODES,
  DEBATE_MODES,
  isValidMode,
  getDefaultMode,
  estimateCost,
  formatCostEstimate,
} from "../utils/debate-modes";

describe("isValidMode", () => {
  it("accepts all known modes", () => {
    for (const mode of ALL_MODES) {
      expect(isValidMode(mode)).toBe(true);
    }
  });

  it("rejects unknown modes", () => {
    expect(isValidMode("unknown")).toBe(false);
    expect(isValidMode("")).toBe(false);
    expect(isValidMode("QUICK")).toBe(false);
  });
});

describe("getDefaultMode", () => {
  it("returns auto", () => {
    expect(getDefaultMode()).toBe("auto");
  });
});

describe("ALL_MODES", () => {
  it("includes the eight deliberation modes", () => {
    const expected = [
      "quick",
      "council",
      "deep",
      "blind",
      "redteam",
      "jury",
      "market",
      "auto",
    ];
    expect(ALL_MODES).toEqual(expect.arrayContaining(expected));
    expect(ALL_MODES).toHaveLength(8);
  });
});

describe("estimateCost", () => {
  it("returns non-negative values", () => {
    for (const mode of ALL_MODES) {
      const estimate = estimateCost(mode, 3);
      expect(estimate.total).toBeGreaterThan(0);
      expect(estimate.breakdown.perRound).toBeGreaterThanOrEqual(0);
      expect(estimate.breakdown.judge).toBeGreaterThanOrEqual(0);
    }
  });

  it("scales with model count", () => {
    const est1 = estimateCost("quick", 1);
    const est3 = estimateCost("quick", 3);
    expect(est3.total).toBeGreaterThan(est1.total);
  });

  it("includes subAgents cost for modes that use them", () => {
    const deep = estimateCost("deep", 3);
    expect(deep.breakdown.subAgents).toBeGreaterThan(0);
  });

  it("omits subAgents cost for modes that do not use them", () => {
    const quick = estimateCost("quick", 3);
    expect(quick.breakdown.subAgents).toBeUndefined();
  });

  it("returns estimatedTime string", () => {
    const est = estimateCost("council", 3);
    expect(est.estimatedTime).toMatch(/~\d+s/);
  });
});

describe("formatCostEstimate", () => {
  it("includes total cost, per-round, judge, and time", () => {
    const est = estimateCost("council", 3);
    const formatted = formatCostEstimate(est);
    expect(formatted).toContain("Estimated cost:");
    expect(formatted).toContain("Per round:");
    expect(formatted).toContain("Judge:");
    expect(formatted).toContain("Time:");
  });

  it("includes sub-agents line when present", () => {
    const est = estimateCost("deep", 3);
    const formatted = formatCostEstimate(est);
    expect(formatted).toContain("Sub-agents:");
  });

  it("omits sub-agents line when absent", () => {
    const est = estimateCost("quick", 3);
    const formatted = formatCostEstimate(est);
    expect(formatted).not.toContain("Sub-agents:");
  });
});

describe("DEBATE_MODES config", () => {
  it("each mode has required fields", () => {
    for (const [, cfg] of Object.entries(DEBATE_MODES)) {
      expect(cfg.rounds).toBeGreaterThanOrEqual(1);
      expect(typeof cfg.subAgents).toBe("boolean");
      expect(cfg.estimatedCost).toBeGreaterThan(0);
      expect(cfg.description).toBeTruthy();
      expect(cfg.estimatedTime).toMatch(/~/);
    }
  });
});
