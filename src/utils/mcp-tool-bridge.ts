import {
  ConsiliumClient,
  DeliberationEvent,
  DebateEvent,
  ToolSchema,
} from "../api/client";
import { McpRegistry } from "./mcp-client/registry";
import { style } from "./visual-system";
import {
  BUILTIN_TOOLS,
  callBuiltinTool,
  isBuiltinTool,
  type ToolContext,
} from "../tools/builtin-tools.js";

const st = style();

const DEFAULT_BUDGET = {
  maxCallsPerTurn: 5,
  maxTotalCalls: 50,
  perCallTimeoutMs: 30000,
};

export interface ToolBridgeOptions {
  enabled: boolean;
  quiet?: boolean;
  /**
   * If true, advertise the in-process Consilium tool suite (Read, Edit,
   * Write, Glob, Grep, GitDiff, Bash). Defaults to true so agents can
   * reach the codebase without any MCP server setup.
   */
  builtinsEnabled?: boolean;
  /**
   * Run the local file/exec tools in read-only mode (Edit/Write/Bash refuse).
   */
  readOnly?: boolean;
  /**
   * Project root for built-in tool calls. Defaults to process.cwd().
   */
  cwd?: string;
}

export interface ToolBridgeHandle {
  tools: ToolSchema[];
  toolBudget: typeof DEFAULT_BUDGET;
  handleEvent: (
    event: DebateEvent | DeliberationEvent,
    deliberationId: string,
  ) => Promise<void>;
  shutdown: () => Promise<void>;
}

export async function startToolBridge(
  client: ConsiliumClient,
  options: ToolBridgeOptions,
): Promise<ToolBridgeHandle | null> {
  if (!options.enabled) return null;

  const builtinsEnabled = options.builtinsEnabled !== false;
  const cwd = options.cwd ?? process.cwd();
  const toolCtx: ToolContext = { cwd, readOnly: options.readOnly };

  const registry = new McpRegistry();
  const { started, failed } = await registry.startAll();

  if (!options.quiet) {
    if (started.length > 0) {
      console.log(
        st.dim(
          `[mcp] ${started.length} server${started.length === 1 ? "" : "s"} ready: ${started.join(", ")}`,
        ),
      );
    }
    for (const f of failed) {
      console.log(st.warning(`[mcp] ${f.name} failed to start: ${f.error}`));
    }
  }

  const registered = registry.listTools();
  const externalTools: ToolSchema[] = registered.map((t) => ({
    qualifiedName: t.qualifiedName,
    description: t.tool.description,
    inputSchema: t.tool.inputSchema,
  }));

  const builtinSchemas: ToolSchema[] = builtinsEnabled
    ? BUILTIN_TOOLS.map((t) => ({
        qualifiedName: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }))
    : [];

  const tools: ToolSchema[] = [...builtinSchemas, ...externalTools];

  if (tools.length === 0) {
    await registry.stopAll();
    if (!options.quiet) {
      console.log(
        st.dim("[mcp] no tools available - continuing without tool access"),
      );
    }
    return null;
  }

  if (!options.quiet && builtinsEnabled) {
    console.log(
      st.dim(
        `[tools] ${builtinSchemas.length} built-in (read/edit/grep/...) + ${externalTools.length} from MCP servers`,
      ),
    );
  }

  // Per-deliberation tool-call counters. The budget message says
  // "...for this debate", which was a lie when totalCalls was a single
  // bridge-scoped counter - debate #2 inherited the budget consumed by
  // debate #1. Tracking by deliberationId restores the documented
  // contract.
  const callsByDeliberation = new Map<string, number>();
  // Per-deliberation set of in-flight callIds. SSE reconnects can
  // replay events with the same callId; without dedup the bridge
  // would invoke the same MCP tool twice, double-charge the budget,
  // and post conflicting tool results.
  const seenCalls = new Map<string, Set<string>>();

  function bumpAndCheckBudget(deliberationId: string): boolean {
    const next = (callsByDeliberation.get(deliberationId) ?? 0) + 1;
    callsByDeliberation.set(deliberationId, next);
    return next <= DEFAULT_BUDGET.maxTotalCalls;
  }

  function markSeen(deliberationId: string, callId: string): boolean {
    let set = seenCalls.get(deliberationId);
    if (!set) {
      set = new Set();
      seenCalls.set(deliberationId, set);
    }
    if (set.has(callId)) return false;
    set.add(callId);
    return true;
  }

  async function postResultSafely(
    deliberationId: string,
    callId: string,
    result: Parameters<typeof client.postToolResult>[2],
  ): Promise<void> {
    try {
      await client.postToolResult(deliberationId, callId, result);
    } catch (err) {
      // postToolResult was previously fire-and-forget; failures
      // disappeared into a void. Log so the operator at least knows
      // the engine never received the tool result.
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        st.warning(
          `[mcp] failed to deliver tool result for ${deliberationId}/${callId}: ${message}`,
        ),
      );
    }
  }

  return {
    tools,
    toolBudget: DEFAULT_BUDGET,
    handleEvent: async (event, deliberationId) => {
      if (event.type !== "tool:call_request") return;
      const {
        callId,
        name,
        arguments: args,
      } = event as {
        callId?: string;
        name?: string;
        arguments?: Record<string, unknown>;
      };
      if (!callId || !name) return;

      if (!markSeen(deliberationId, callId)) {
        // Duplicate request from an SSE replay - already handled.
        return;
      }

      if (!bumpAndCheckBudget(deliberationId)) {
        await postResultSafely(deliberationId, callId, {
          content: [
            { type: "text", text: "Tool budget exhausted for this debate." },
          ],
          isError: true,
        });
        return;
      }

      if (!options.quiet) {
        console.log(
          st.dim(`[tools] ${name}(${JSON.stringify(args ?? {}).slice(0, 80)})`),
        );
      }

      try {
        if (builtinsEnabled && isBuiltinTool(name)) {
          const result = await callBuiltinTool(name, args ?? {}, toolCtx);
          await postResultSafely(deliberationId, callId, result);
          return;
        }
        const result = await registry.callTool(name, args ?? {});
        await postResultSafely(deliberationId, callId, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await postResultSafely(deliberationId, callId, {
          content: [{ type: "text", text: `Tool call failed: ${message}` }],
          isError: true,
        });
      }
    },
    shutdown: async () => {
      callsByDeliberation.clear();
      seenCalls.clear();
      await registry.stopAll();
    },
  };
}
