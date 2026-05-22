import { execFile } from "node:child_process";
import {
  getConfigPath,
  getServer,
  removeServer,
  upsertServer,
} from "../utils/mcp-client/config";
import {
  REGISTRY,
  findByName,
  searchRegistry,
  type MCPCategory,
  type MCPServerEntry,
} from "../utils/mcp-registry";
import { style } from "../utils/visual-system";

const st = style();

const CATEGORY_ORDER: MCPCategory[] = [
  "productivity",
  "dev-tools",
  "data",
  "communication",
  "other",
];

const CATEGORY_LABEL: Record<MCPCategory, string> = {
  productivity: "Productivity",
  "dev-tools": "Developer Tools",
  data: "Data",
  communication: "Communication",
  other: "Other",
};

export interface BrowseOptions {
  json?: boolean;
}

export interface SearchOptions {
  json?: boolean;
}

export interface InstallOptions {
  json?: boolean;
}

export interface UninstallOptions {
  json?: boolean;
  keepPackage?: boolean;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

type ExecFileRunner = (cmd: string, args: string[]) => Promise<ExecResult>;

const defaultExecFileRunner: ExecFileRunner = (cmd, args) =>
  new Promise<ExecResult>((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      { maxBuffer: 1024 * 1024 * 10 },
      (err, stdout, stderr) => {
        if (err) {
          const code = (err as NodeJS.ErrnoException & { code?: number }).code;
          if (typeof code === "string") {
            reject(err);
            return;
          }
          resolve({
            stdout: stdout?.toString() ?? "",
            stderr: stderr?.toString() ?? "",
            code: typeof code === "number" ? code : 1,
          });
          return;
        }
        resolve({
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          code: 0,
        });
      },
    );
    if (child.stdout) child.stdout.pipe(process.stdout);
    if (child.stderr) child.stderr.pipe(process.stderr);
  });

let execFileRunner: ExecFileRunner = defaultExecFileRunner;

export function __setExecFileRunnerForTests(
  runner: ExecFileRunner | null,
): void {
  execFileRunner = runner ?? defaultExecFileRunner;
}

function printEntry(entry: MCPServerEntry): void {
  const installCmd = entry.npmPackage
    ? `consilium mcp install ${entry.name}  (npm: ${entry.npmPackage})`
    : entry.pythonPackage
      ? `consilium mcp install ${entry.name}  (pip: ${entry.pythonPackage})`
      : `consilium mcp install ${entry.name}`;
  console.log(`  ${st.brand(entry.displayName)} ${st.dim(`(${entry.name})`)}`);
  console.log(st.dim(`    ${entry.description}`));
  console.log(st.dim(`    install: ${installCmd}`));
  if (entry.envVars && entry.envVars.length > 0) {
    console.log(st.dim(`    env: ${entry.envVars.join(", ")}`));
  }
}

export function browseCommand(options: BrowseOptions = {}): void {
  if (options.json) {
    console.log(JSON.stringify({ entries: REGISTRY }, null, 2));
    return;
  }

  console.log(st.brand("\nMCP Server Marketplace"));
  console.log(
    st.dim(
      `${REGISTRY.length} curated servers. Run \`consilium mcp install <name>\` to add one.\n`,
    ),
  );

  for (const category of CATEGORY_ORDER) {
    const entries = REGISTRY.filter((e) => e.category === category);
    if (entries.length === 0) continue;
    console.log(st.bold(CATEGORY_LABEL[category]));
    for (const entry of entries) printEntry(entry);
    console.log("");
  }

  console.log(
    st.dim(
      `Tip: after install, add the entry to your settings file: ${getConfigPath()}`,
    ),
  );
}

export function searchCommand(
  query: string | undefined,
  options: SearchOptions = {},
): void {
  const q = (query ?? "").trim();
  if (!q) {
    console.error(st.error("Usage: consilium mcp search <query>"));
    process.exitCode = 1;
    return;
  }
  const results = searchRegistry(q);
  if (options.json) {
    console.log(JSON.stringify({ query: q, results }, null, 2));
    return;
  }
  if (results.length === 0) {
    console.log(
      st.dim(`No MCP servers matched "${q}". Try \`consilium mcp browse\`.`),
    );
    return;
  }
  console.log(
    st.bold(
      `\n${results.length} result${results.length === 1 ? "" : "s"} for "${q}"\n`,
    ),
  );
  for (const entry of results) printEntry(entry);
  console.log("");
}

function suggestClosestName(target: string): string | null {
  const lower = target.toLowerCase();
  const close = REGISTRY.filter(
    (e) =>
      e.name.includes(lower) ||
      lower.includes(e.name) ||
      e.displayName.toLowerCase().includes(lower),
  );
  return close[0]?.name ?? null;
}

export async function installCommand(
  name: string | undefined,
  options: InstallOptions = {},
): Promise<void> {
  if (!name) {
    console.error(st.error("Usage: consilium mcp install <name>"));
    process.exitCode = 1;
    return;
  }

  const entry = findByName(name);
  if (!entry) {
    const suggestion = suggestClosestName(name);
    const hint = suggestion
      ? ` Did you mean "${suggestion}"? Or run \`consilium mcp browse\`.`
      : " Run `consilium mcp browse` to see available servers.";
    console.error(st.error(`Unknown MCP server "${name}".${hint}`));
    process.exitCode = 1;
    return;
  }

  if (entry.npmPackage) {
    console.log(
      st.dim(`Installing ${entry.npmPackage} via npm install -g ...`),
    );
    try {
      const result = await execFileRunner("npm", [
        "install",
        "-g",
        entry.npmPackage,
      ]);
      if (result.code !== 0) {
        console.error(
          st.error(
            `npm install -g ${entry.npmPackage} exited with code ${result.code}`,
          ),
        );
        process.exitCode = 1;
        return;
      }
    } catch (err) {
      console.error(
        st.error(`Failed to run npm install: ${(err as Error).message}`),
      );
      process.exitCode = 1;
      return;
    }
  } else if (entry.pythonPackage) {
    console.log(
      st.warning(
        `${entry.displayName} ships as a Python package; install manually:`,
      ),
    );
    console.log(st.dim(`  pip install ${entry.pythonPackage}`));
    console.log(st.dim(`  # or: uvx ${entry.pythonPackage}`));
  } else {
    console.log(
      st.dim(`${entry.displayName} has no automated installer; see homepage.`),
    );
  }

  const template = entry.configTemplate as Record<string, unknown>;
  const cmd =
    typeof template["command"] === "string"
      ? (template["command"] as string)
      : "npx";
  const args = Array.isArray(template["args"])
    ? (template["args"] as string[])
    : [];
  const env =
    template["env"] && typeof template["env"] === "object"
      ? (template["env"] as Record<string, string>)
      : undefined;

  try {
    upsertServer({
      name: entry.name,
      command: cmd,
      args,
      env,
      transport: "stdio",
    });
  } catch (err) {
    console.error(
      st.error(`Failed to write MCP config: ${(err as Error).message}`),
    );
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          installed: entry.name,
          config: getConfigPath(),
          envVars: entry.envVars ?? [],
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(st.success(`Installed MCP server "${entry.name}"`));
  console.log(st.dim(`  Config: ${getConfigPath()}`));
  if (entry.envVars && entry.envVars.length > 0) {
    console.log(st.dim("  Required env vars:"));
    for (const v of entry.envVars) console.log(st.dim(`    - ${v}`));
  }
  console.log(st.dim(`  Test it: consilium mcp test ${entry.name}`));
}

export async function uninstallCommand(
  name: string | undefined,
  options: UninstallOptions = {},
): Promise<void> {
  if (!name) {
    console.error(st.error("Usage: consilium mcp uninstall <name>"));
    process.exitCode = 1;
    return;
  }

  const entry = findByName(name);
  const existing = getServer(name);
  if (!entry && !existing) {
    console.error(st.error(`No MCP server named "${name}".`));
    process.exitCode = 1;
    return;
  }

  const removed = removeServer(name);

  if (entry?.npmPackage && !options.keepPackage) {
    console.log(
      st.dim(`Uninstalling ${entry.npmPackage} via npm uninstall -g ...`),
    );
    try {
      const result = await execFileRunner("npm", [
        "uninstall",
        "-g",
        entry.npmPackage,
      ]);
      if (result.code !== 0) {
        console.error(
          st.warning(
            `npm uninstall -g ${entry.npmPackage} exited with code ${result.code}; config entry was removed regardless.`,
          ),
        );
      }
    } catch (err) {
      console.error(
        st.warning(
          `Failed to run npm uninstall: ${(err as Error).message}; config entry was removed regardless.`,
        ),
      );
    }
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          uninstalled: name,
          configRemoved: removed,
          npmRemoved: Boolean(entry?.npmPackage && !options.keepPackage),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (removed) {
    console.log(st.success(`Removed "${name}" from MCP config`));
  } else {
    console.log(
      st.dim(`"${name}" was not in the MCP config; nothing to remove.`),
    );
  }
}
