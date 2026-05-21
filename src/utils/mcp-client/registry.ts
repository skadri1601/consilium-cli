import { listServers } from "./config";
import { StdioMcpClient } from "./stdio-client";
import {
  McpClientError,
  McpServerConfig,
  McpTool,
  McpToolResult,
} from "./types";

export interface RegisteredTool {
  server: string;
  qualifiedName: string;
  tool: McpTool;
}

export class McpRegistry {
  private clients = new Map<string, StdioMcpClient>();
  private tools: RegisteredTool[] = [];

  async startAll(configs?: McpServerConfig[]): Promise<{
    started: string[];
    failed: Array<{ name: string; error: string }>;
  }> {
    const effective =
      configs ?? listServers().filter((c) => c.enabled !== false);
    const started: string[] = [];
    const failed: Array<{ name: string; error: string }> = [];

    const results = await Promise.allSettled(
      effective.map(async (cfg) => {
        const client = new StdioMcpClient(cfg);
        try {
          await client.start();
          const tools = await client.listTools();
          this.clients.set(cfg.name, client);
          for (const t of tools) {
            this.tools.push({
              server: cfg.name,
              qualifiedName: `${cfg.name}.${t.name}`,
              tool: t,
            });
          }
          return cfg.name;
        } catch (err) {
          // start() may have spawned the child process before listTools()
          // failed; ensure we kill it so we don't leak a runaway server.
          await client.stop().catch(() => {
            /* best-effort cleanup */
          });
          throw err;
        }
      }),
    );

    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      const cfg = effective[i]!;
      if (r.status === "fulfilled") {
        started.push(r.value);
      } else {
        const reason =
          r.reason instanceof Error ? r.reason.message : String(r.reason);
        failed.push({ name: cfg.name, error: reason });
      }
    }

    return { started, failed };
  }

  listTools(): RegisteredTool[] {
    return this.tools.slice();
  }

  async callTool(
    qualifiedName: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> {
    const dotIdx = qualifiedName.indexOf(".");
    if (dotIdx === -1) {
      throw new McpClientError(
        qualifiedName,
        `qualifiedName must be <server>.<tool>`,
      );
    }
    const server = qualifiedName.slice(0, dotIdx);
    const toolName = qualifiedName.slice(dotIdx + 1);
    const client = this.clients.get(server);
    if (!client) {
      throw new McpClientError(server, `server "${server}" is not running`);
    }
    return client.callTool(toolName, args);
  }

  async stopAll(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.clients.values()).map((c) => c.stop()),
    );
    this.clients.clear();
    this.tools = [];
  }
}
