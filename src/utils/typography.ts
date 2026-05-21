/**
 * Text hierarchy and semantic styles for consistent CLI output.
 */

import chalk from "chalk";
import { terminal } from "./terminal-capabilities";
import { style } from "./visual-system";

const st = style();

export const typography = {
  h1: (s: string) => (terminal.hasColor ? chalk.bold.hex("#6366f1")(s) : s),
  h2: (s: string) => (terminal.hasColor ? chalk.bold(s) : s),
  body: (s: string) => s,
  caption: (s: string) => st.dim(s),
  code: (s: string) => (terminal.hasColor ? chalk.cyan(s) : s),
  brand: (s: string) => st.brand(s),
  agent: (s: string) => (terminal.hasColor ? chalk.hex("#6366f1")(s) : s),
  prompt: (s: string) => st.dim(s),
  status: (s: string) => st.dim(s),
  success: (s: string) => st.success(s),
  error: (s: string) => st.error(s),
  warning: (s: string) => st.warning(s),
};
