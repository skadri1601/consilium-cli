/**
 * Smooth transitions and debounced rendering for CLI output.
 * Max 30fps to avoid flicker and excessive redraws.
 */

import logUpdate from "log-update";
import { terminal } from "./terminal-capabilities";

const TARGET_FPS = 30;
const FRAME_MS = 1000 / TARGET_FPS;

let lastRender = 0;
let pendingContent: string | null = null;
let rafId: ReturnType<typeof setImmediate> | null = null;

function flush() {
  if (pendingContent === null) return;
  if (terminal.isTTY && !terminal.usePlain) {
    logUpdate(pendingContent);
  } else if (rafId === null) {
    process.stdout.write(pendingContent + "\n");
  }
  pendingContent = null;
  rafId = null;
  lastRender = Date.now();
}

/**
 * Schedule a content update. Debounced to ~30fps when called rapidly.
 */
export function updateLine(content: string): void {
  pendingContent = content;
  if (rafId !== null) return;
  const elapsed = Date.now() - lastRender;
  if (elapsed >= FRAME_MS || lastRender === 0) {
    flush();
    return;
  }
  rafId = setImmediate(() => {
    rafId = null;
    flush();
  });
}

/**
 * Stop live updates and clear the update area (e.g. before printing more lines).
 */
export function stopUpdates(): void {
  if (rafId !== null) {
    clearImmediate(rafId);
    rafId = null;
  }
  pendingContent = null;
  if (terminal.isTTY && !terminal.usePlain) {
    logUpdate.clear();
  }
}
