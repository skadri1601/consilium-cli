/**
 * Multi-step progress for debate initialization.
 * Shows steps: Health check → Auth → Create debate → Start stream.
 */

import { border, borderBottom, borderLine, contentLine } from "./visual-system";
import { terminal } from "./terminal-capabilities";

export type StepStatus = "pending" | "running" | "complete" | "error";

export interface Step {
  id: string;
  label: string;
  status: StepStatus;
  durationMs?: number;
  error?: string;
}

const SPINNER = "⠸";
const CHECK = "✓";
const PENDING = " ";

function iconForStepStatus(status: StepStatus): string {
  if (status === "complete") return CHECK;
  if (status === "running") return SPINNER;
  return PENDING;
}

function suffixForStepRow(s: Step): string {
  if (s.durationMs != null) return `${s.durationMs}ms`;
  if (s.status === "running") return "...";
  return "";
}

export function renderSteps(
  title: string,
  steps: Step[],
  width?: number,
): string {
  const w = width ?? terminal.width;
  const lines: string[] = [border(title, w), borderLine(w)];
  for (const s of steps) {
    const icon = iconForStepStatus(s.status);
    const bracket = `[${icon}]`;
    const suffix = suffixForStepRow(s);
    const text = `${bracket} ${s.label.padEnd(40)} ${suffix}`.trim();
    lines.push(contentLine(text, w));
  }
  lines.push(borderLine(w), borderBottom(w));
  return lines.join("\n");
}

export function createStepTracker(
  stepIds: string[],
  labels: Record<string, string>,
) {
  const steps: Step[] = stepIds.map((id) => ({
    id,
    label: labels[id] ?? id,
    status: "pending" as StepStatus,
  }));
  const startTimes: Record<string, number> = {};

  return {
    steps,
    start(id: string) {
      const s = steps.find((x) => x.id === id);
      if (s) s.status = "running";
      startTimes[id] = Date.now();
    },
    complete(id: string) {
      const s = steps.find((x) => x.id === id);
      if (s) {
        s.status = "complete";
        s.durationMs =
          id in startTimes ? Date.now() - startTimes[id]! : undefined;
      }
    },
    fail(id: string, error: string) {
      const s = steps.find((x) => x.id === id);
      if (s) {
        s.status = "error";
        s.error = error;
        s.durationMs =
          id in startTimes ? Date.now() - startTimes[id]! : undefined;
      }
    },
    render(title: string = "Initializing") {
      return renderSteps(title, steps);
    },
  };
}
