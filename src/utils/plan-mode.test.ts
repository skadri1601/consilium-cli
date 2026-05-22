import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetForTests,
  clearPlan,
  enterPlanMode,
  exitPlanMode,
  getPlan,
  isPlanModeActive,
  recordPlanStep,
  renderPlan,
} from "./plan-mode";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("plan-mode", () => {
  beforeEach(() => {
    _resetForTests();
  });

  it("starts inactive with empty plan", () => {
    expect(isPlanModeActive()).toBe(false);
    expect(getPlan()).toEqual([]);
  });

  it("enterPlanMode activates and sets env var", () => {
    enterPlanMode();
    expect(isPlanModeActive()).toBe(true);
    expect(process.env.CONSILIUM_PLAN_MODE).toBe("1");
  });

  it("exitPlanMode deactivates and clears env var", () => {
    enterPlanMode();
    exitPlanMode();
    expect(isPlanModeActive()).toBe(false);
    expect(process.env.CONSILIUM_PLAN_MODE).toBeUndefined();
  });

  it("isPlanModeActive reads env var even if module state is reset", () => {
    process.env.CONSILIUM_PLAN_MODE = "1";
    expect(isPlanModeActive()).toBe(true);
  });

  it("recordPlanStep returns a step with a UUID id and pending status", () => {
    enterPlanMode();
    const step = recordPlanStep("Read the config");
    expect(step.id).toMatch(UUID_RE);
    expect(step.description).toBe("Read the config");
    expect(step.status).toBe("pending");
  });

  it("getPlan returns steps in insertion order", () => {
    enterPlanMode();
    const a = recordPlanStep("Step one");
    const b = recordPlanStep("Step two");
    const c = recordPlanStep("Step three");
    const plan = getPlan();
    expect(plan).toHaveLength(3);
    expect(plan[0]?.id).toBe(a.id);
    expect(plan[1]?.id).toBe(b.id);
    expect(plan[2]?.id).toBe(c.id);
  });

  it("getPlan returns a defensive copy", () => {
    enterPlanMode();
    recordPlanStep("Mutate me");
    const plan = getPlan();
    plan[0]!.description = "Hacked";
    expect(getPlan()[0]?.description).toBe("Mutate me");
  });

  it("renderPlan formats steps with numbered markers", () => {
    enterPlanMode();
    recordPlanStep("First action");
    recordPlanStep("Second action");
    const out = renderPlan();
    expect(out).toContain("First action");
    expect(out).toContain("Second action");
    expect(out).toContain("1.");
    expect(out).toContain("2.");
    expect(out).toContain("[ ]");
  });

  it("renderPlan reports inactive when no plan", () => {
    const out = renderPlan();
    expect(out.toLowerCase()).toContain("inactive");
  });

  it("clearPlan empties steps without changing active state", () => {
    enterPlanMode();
    recordPlanStep("A");
    recordPlanStep("B");
    clearPlan();
    expect(getPlan()).toEqual([]);
    expect(isPlanModeActive()).toBe(true);
  });
});
