import { randomUUID } from "node:crypto";
import readline from "node:readline";
import { style } from "./visual-system";

const st = style();

export type PlanStepStatus = "pending" | "approved" | "rejected";

export type PlanStep = {
  id: string;
  description: string;
  status: PlanStepStatus;
};

type PlanModeInternalState = {
  active: boolean;
  enteredAt: number | null;
  steps: PlanStep[];
};

const state: PlanModeInternalState = {
  active: false,
  enteredAt: null,
  steps: [],
};

export function isPlanModeActive(): boolean {
  if (process.env.CONSILIUM_PLAN_MODE === "1") return true;
  return state.active;
}

export function enterPlanMode(): void {
  state.active = true;
  state.enteredAt = Date.now();
  process.env.CONSILIUM_PLAN_MODE = "1";
}

export function exitPlanMode(): void {
  state.active = false;
  state.enteredAt = null;
  delete process.env.CONSILIUM_PLAN_MODE;
}

export function recordPlanStep(description: string): PlanStep {
  const step: PlanStep = {
    id: randomUUID(),
    description: description.trim(),
    status: "pending",
  };
  state.steps.push(step);
  return step;
}

export function getPlan(): PlanStep[] {
  return state.steps.map((s) => ({ ...s }));
}

export function clearPlan(): void {
  state.steps = [];
}

export function renderPlan(): string {
  const header = isPlanModeActive()
    ? st.brand("Plan mode")
    : st.dim("Plan mode (inactive)");

  if (state.steps.length === 0) {
    return `${header}\n${st.dim("  (no steps recorded)")}`;
  }

  const maxNumWidth = String(state.steps.length).length;
  const lines = state.steps.map((step, idx) => {
    const num = String(idx + 1).padStart(maxNumWidth, " ");
    const marker =
      step.status === "approved"
        ? st.success("[x]")
        : step.status === "rejected"
          ? st.error("[!]")
          : st.warning("[ ]");
    return `  ${st.dim(num + ".")} ${marker} ${step.description}`;
  });

  return [header, ...lines].join("\n");
}

export async function promptApproval(): Promise<
  "approve" | "refine" | "cancel"
> {
  if (!process.stdin.isTTY) {
    return "approve";
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(st.brand("\n[a]pprove / [r]efine / [c]ancel: "), (raw) =>
        resolve(raw),
      );
    });
    const trimmed = answer.trim().toLowerCase();
    if (trimmed.startsWith("a")) return "approve";
    if (trimmed.startsWith("r")) return "refine";
    return "cancel";
  } finally {
    rl.close();
  }
}

export function _resetForTests(): void {
  state.active = false;
  state.enteredAt = null;
  state.steps = [];
  delete process.env.CONSILIUM_PLAN_MODE;
}
