import type { ChatSession } from "../chat-session";

export type LoopHandle = {
  id: string;
  intervalMs: number;
  prompt: string;
  timer: NodeJS.Timeout;
};

export type ScheduleHandle = {
  id: string;
  prompt: string;
  spec: string;
  intervalMs: number;
  timer: NodeJS.Timeout;
};

export interface SessionExtras {
  goal?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
  loops: Map<string, LoopHandle>;
  schedules: Map<string, ScheduleHandle>;
  customCommandsLoaded: boolean;
  customCommands: Map<string, CustomCommandLike>;
  activeDebateId?: string;
}

export interface CustomCommandLike {
  name: string;
  filePath: string;
  template: string;
  description?: string;
}

const sessionExtras = new Map<string, SessionExtras>();

export function getExtras(session: ChatSession): SessionExtras {
  const key = session.id ?? "__pending__";
  let extras = sessionExtras.get(key);
  if (!extras) {
    extras = {
      loops: new Map(),
      schedules: new Map(),
      customCommandsLoaded: false,
      customCommands: new Map(),
    };
    sessionExtras.set(key, extras);
  }
  return extras;
}

export function getSessionExtras(
  session: ChatSession,
): Readonly<SessionExtras> {
  return getExtras(session);
}

export function setActiveDebateId(
  session: ChatSession,
  debateId: string,
): void {
  getExtras(session).activeDebateId = debateId;
}

export function clearActiveDebateId(session: ChatSession): void {
  getExtras(session).activeDebateId = undefined;
}

export function parseDurationToMs(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed === "daily") return 24 * 60 * 60 * 1000;
  if (trimmed === "hourly") return 60 * 60 * 1000;
  const m = trimmed.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = m[2] ?? "m";
  const multiplier =
    unit === "ms"
      ? 1
      : unit === "s"
        ? 1000
        : unit === "m"
          ? 60 * 1000
          : unit === "h"
            ? 60 * 60 * 1000
            : unit === "d"
              ? 24 * 60 * 60 * 1000
              : 60 * 1000;
  return Math.round(value * multiplier);
}

export function makeLocalId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

export function formatDurationMs(ms: number): string {
  if (ms % (24 * 60 * 60 * 1000) === 0) return `${ms / (24 * 60 * 60 * 1000)}d`;
  if (ms % (60 * 60 * 1000) === 0) return `${ms / (60 * 60 * 1000)}h`;
  if (ms % (60 * 1000) === 0) return `${ms / (60 * 1000)}m`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}

export type SlashResult = "exit" | "continue" | "delete-pending";
