/**
 * Contextual REPL prompt: consilium › or consilium [3 files] ›
 */

import { style } from "./visual-system";
import { terminal } from "./terminal-capabilities";

const st = style();

export function formatPrompt(context?: {
  fileCount?: number;
  sessionId?: string;
}): string {
  const brand = "consilium";
  const parts: string[] = [];
  if (context?.sessionId) parts.push(context.sessionId);
  if (context?.fileCount != null && context.fileCount > 0)
    parts.push(`${context.fileCount} files`);
  const contextStr = parts.length ? ` [${parts.join(" \u2022 ")}]` : "";
  const prompt = terminal.hasColor
    ? st.brand(brand) + st.dim(contextStr) + " \u203a "
    : brand + contextStr + " > ";
  return prompt;
}
