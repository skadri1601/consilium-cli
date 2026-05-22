import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface CustomCommand {
  name: string;
  filePath: string;
  template: string;
  description?: string;
}

const CUSTOM_COMMANDS_DIR = path.join(os.homedir(), ".consilium", "commands");

export function getCustomCommandsDir(): string {
  return CUSTOM_COMMANDS_DIR;
}

function extractDescription(content: string): string | undefined {
  const match = content.match(
    /^\s*(?:#+\s*description\s*:|<!--\s*description\s*:)\s*(.+?)(?:-->|\n|$)/im,
  );
  if (match && match[1]) {
    return match[1].trim();
  }
  const firstLine = content
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0);
  if (firstLine && firstLine.trim().startsWith("#")) {
    return firstLine.replace(/^#+\s*/, "").trim();
  }
  return undefined;
}

export async function loadCustomCommands(
  dir: string = CUSTOM_COMMANDS_DIR,
): Promise<CustomCommand[]> {
  if (!fs.existsSync(dir)) {
    return [];
  }
  let entries: string[];
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return [];
  }

  const commands: CustomCommand[] = [];
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith(".md")) continue;
    const filePath = path.join(dir, entry);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;

    let template: string;
    try {
      template = await fs.promises.readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    const name = entry.replace(/\.md$/i, "").trim();
    if (!name) continue;
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) continue;

    commands.push({
      name,
      filePath,
      template,
      description: extractDescription(template),
    });
  }

  commands.sort((a, b) => a.name.localeCompare(b.name));
  return commands;
}

export function executeCustomCommand(
  cmd: CustomCommand,
  args: string | string[],
): string {
  const argString = Array.isArray(args) ? args.join(" ") : args;
  const safeArgs = argString ?? "";
  return cmd.template.replace(/\$ARGUMENTS/g, safeArgs);
}
