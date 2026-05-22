import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VALID_SHELLS = ["bash", "zsh", "fish"] as const;
type Shell = (typeof VALID_SHELLS)[number];

function isShell(value: string): value is Shell {
  return (VALID_SHELLS as readonly string[]).includes(value);
}

function resolveCompletionsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "..", "completions"),
    path.join(here, "..", "..", "completions"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}

export function installInstructions(shell: string): string {
  switch (shell) {
    case "bash":
      return 'eval "$(consilium completions bash)" >> ~/.bashrc';
    case "zsh":
      return 'consilium completions zsh > "${fpath[1]}/_consilium"';
    case "fish":
      return "consilium completions fish > ~/.config/fish/completions/consilium.fish";
    default:
      return "";
  }
}

export async function completionsCommand(shell: string): Promise<void> {
  if (!isShell(shell)) {
    console.error(
      `Unknown shell: ${shell}. Supported: ${VALID_SHELLS.join(", ")}`,
    );
    process.exit(1);
    return;
  }
  const completionsDir = resolveCompletionsDir();
  const scriptPath = path.join(completionsDir, `consilium.${shell}`);
  if (!fs.existsSync(scriptPath)) {
    console.error(`Completion script not found at ${scriptPath}`);
    process.exit(1);
    return;
  }
  const content = fs.readFileSync(scriptPath, "utf-8");
  process.stdout.write(content);
  if (!content.endsWith("\n")) process.stdout.write("\n");
}
