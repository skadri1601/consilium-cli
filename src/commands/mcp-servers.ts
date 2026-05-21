import {
  addServer,
  getConfigPath,
  getServer,
  listServers,
  removeServer,
} from "../utils/mcp-client/config";
import { StdioMcpClient } from "../utils/mcp-client/stdio-client";
import { McpRegistry } from "../utils/mcp-client/registry";
import { style } from "../utils/visual-system";

const st = style();

export interface AddOptions {
  env?: string[];
  json?: boolean;
}

function parseEnvFlags(flags?: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of flags ?? []) {
    const eq = entry.indexOf("=");
    if (eq <= 0) {
      throw new Error(`--env expects KEY=value, got "${entry}"`);
    }
    out[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return out;
}

export function addServerCommand(
  name: string,
  command: string,
  commandArgs: string[] | undefined,
  options: AddOptions,
): void {
  try {
    const env = parseEnvFlags(options.env);
    addServer({
      name,
      command,
      args: commandArgs ?? [],
      env: Object.keys(env).length ? env : undefined,
      transport: "stdio",
    });
    if (options.json) {
      console.log(JSON.stringify({ added: name, config: getConfigPath() }));
      return;
    }
    console.log(st.success(`Added MCP server "${name}"`));
    console.log(st.dim(`  Config: ${getConfigPath()}`));
    console.log(st.dim(`  Test it: consilium mcp test ${name}`));
  } catch (err) {
    console.error(st.error((err as Error).message));
    process.exitCode = 1;
  }
}

export interface ListOptions {
  json?: boolean;
}

export function listServersCommand(options: ListOptions = {}): void {
  const servers = listServers();
  if (options.json) {
    console.log(JSON.stringify(servers, null, 2));
    return;
  }
  if (servers.length === 0) {
    console.log(
      st.dim(
        `No MCP servers configured. Add one with: consilium mcp add <name> <command>`,
      ),
    );
    return;
  }
  console.log(
    st.bold(
      `\n${servers.length} MCP server${servers.length === 1 ? "" : "s"}\n`,
    ),
  );
  for (const s of servers) {
    const enabled =
      s.enabled === false ? st.warning("disabled") : st.dim("enabled");
    console.log(st.brand(`  ${s.name}`) + `  ${enabled}`);
    const argsDisplay = (s.args ?? []).join(" ");
    console.log(
      st.dim(`    ${s.command}${argsDisplay ? " " + argsDisplay : ""}`),
    );
    if (s.env && Object.keys(s.env).length > 0) {
      console.log(st.dim(`    env: ${Object.keys(s.env).join(", ")}`));
    }
  }
  console.log("");
}

export function removeServerCommand(name: string): void {
  const removed = removeServer(name);
  if (!removed) {
    console.error(st.error(`No MCP server named "${name}"`));
    process.exitCode = 1;
    return;
  }
  console.log(st.success(`Removed MCP server "${name}"`));
}

export interface TestOptions {
  json?: boolean;
}

export async function testServerCommand(
  name: string,
  options: TestOptions = {},
): Promise<void> {
  const cfg = getServer(name);
  if (!cfg) {
    console.error(st.error(`No MCP server named "${name}"`));
    process.exitCode = 1;
    return;
  }
  const client = new StdioMcpClient(cfg, { startupTimeoutMs: 10000 });
  try {
    await client.start();
    const tools = await client.listTools();
    if (options.json) {
      console.log(JSON.stringify({ ok: true, tools }, null, 2));
    } else {
      console.log(st.success(`${name}: ready`));
      console.log(
        st.dim(
          `  ${tools.length} tool${tools.length === 1 ? "" : "s"} exposed`,
        ),
      );
      for (const t of tools) {
        const desc = t.description ? ` - ${t.description.slice(0, 60)}` : "";
        console.log(`    ${st.brand(t.name)}${desc}`);
      }
    }
  } catch (err) {
    const message = (err as Error).message;
    const stderr = client.getStderr().slice(-500);
    if (options.json) {
      console.log(JSON.stringify({ ok: false, error: message, stderr }));
    } else {
      console.error(st.error(`${name}: ${message}`));
      if (stderr) {
        console.error(st.dim("  stderr:"));
        console.error(st.dim("    " + stderr.split("\n").join("\n    ")));
      }
    }
    process.exitCode = 1;
  } finally {
    await client.stop();
  }
}

export interface ToolsOptions {
  json?: boolean;
}

export async function toolsCommand(options: ToolsOptions = {}): Promise<void> {
  const registry = new McpRegistry();
  const result = await registry.startAll();
  const allTools = registry.listTools();

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          started: result.started,
          failed: result.failed,
          tools: allTools.map((t) => ({
            qualifiedName: t.qualifiedName,
            server: t.server,
            description: t.tool.description,
          })),
        },
        null,
        2,
      ),
    );
    await registry.stopAll();
    return;
  }

  if (result.started.length === 0 && result.failed.length === 0) {
    console.log(
      st.dim(
        `No MCP servers configured. Add one with: consilium mcp add <name> <command>`,
      ),
    );
    await registry.stopAll();
    return;
  }

  if (result.failed.length > 0) {
    console.log(
      st.warning(
        `\n${result.failed.length} server${result.failed.length === 1 ? "" : "s"} failed to start:`,
      ),
    );
    for (const f of result.failed) {
      console.log(st.error(`  ${f.name}: ${f.error}`));
    }
  }

  if (allTools.length === 0) {
    console.log(st.dim("\nNo tools available."));
    await registry.stopAll();
    return;
  }

  const byServer = new Map<string, typeof allTools>();
  for (const t of allTools) {
    const list = byServer.get(t.server) ?? [];
    list.push(t);
    byServer.set(t.server, list);
  }

  console.log(
    st.bold(
      `\n${allTools.length} tool${allTools.length === 1 ? "" : "s"} from ${byServer.size} server${byServer.size === 1 ? "" : "s"}\n`,
    ),
  );
  for (const [server, tools] of byServer) {
    console.log(st.brand(`  ${server}`));
    for (const t of tools) {
      const desc = t.tool.description
        ? ` - ${t.tool.description.slice(0, 60)}`
        : "";
      console.log(`    ${t.tool.name}${desc}`);
    }
  }
  console.log("");

  await registry.stopAll();
}
