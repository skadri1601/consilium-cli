import {
  ConsiliumClient,
  DebateSummary,
  DebateEvent,
  DeliberationEvent,
} from "../api/client.js";
import { style } from "../utils/visual-system.js";
import { requireAuth } from "../utils/require-auth.js";
import { isValidMode, getDefaultMode } from "../utils/debate-modes.js";
import { loadWorkspaceContext } from "./debate.js";
import { startToolBridge } from "../utils/mcp-tool-bridge.js";
import { getPreferences } from "../utils/config.js";

const st = style();

export interface ListDebatesOptions {
  limit?: string;
  offset?: string;
  search?: string;
  json?: boolean;
}

function formatRelative(iso?: string): string {
  if (!iso) return "";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "";
  const diffMs = Date.now() - ts;
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

export async function listDebatesCommand(
  options: ListDebatesOptions,
): Promise<void> {
  await requireAuth();

  const parsedLimit = options.limit ? Number.parseInt(options.limit, 10) : 20;
  const parsedOffset = options.offset ? Number.parseInt(options.offset, 10) : 0;
  const limit =
    Number.isNaN(parsedLimit) || parsedLimit < 1
      ? 20
      : Math.min(parsedLimit, 100);
  const offset =
    Number.isNaN(parsedOffset) || parsedOffset < 0 ? 0 : parsedOffset;

  const client = new ConsiliumClient();
  let debates: DebateSummary[];
  try {
    debates = await client.listDebates({
      limit,
      offset,
      search: options.search,
    });
  } catch (err) {
    console.error(
      st.error(`Failed to list debates: ${(err as Error).message}`),
    );
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(debates, null, 2));
    return;
  }

  if (debates.length === 0) {
    console.log(st.dim("No debates found."));
    return;
  }

  console.log(
    st.bold(`\n${debates.length} debate${debates.length === 1 ? "" : "s"}\n`),
  );
  for (const d of debates) {
    const topic = truncate(d.topic ?? "(no topic)", 60);
    const mode = d.mode ?? "?";
    const status = d.status ?? "?";
    const when = formatRelative(d.updatedAt ?? d.createdAt);
    console.log(st.brand(`  ${d.id}`));
    console.log(`    ${topic}`);
    console.log(st.dim(`    mode=${mode}  status=${status}  ${when}`));
  }
  console.log("");
  console.log(st.dim(`  consilium debug <id>   consilium logs <id>`));
  console.log("");
}

export async function cancelDebateCommand(
  debateId: string,
  options: { deliberation?: boolean } = {},
): Promise<void> {
  await requireAuth();
  const client = new ConsiliumClient();
  try {
    if (options.deliberation) {
      await client.cancelDeliberation(debateId);
    } else {
      await client.cancelDebate(debateId);
    }
    console.log(st.success(`Cancelled ${debateId}`));
  } catch (err) {
    console.error(st.error(`Cancel failed: ${(err as Error).message}`));
    process.exitCode = 1;
  }
}

export interface StartDebateOptions {
  models?: string[];
  mode?: string;
  json?: boolean;
  file?: string[];
  gitDiff?: boolean;
  /** Commander negation - present and false when --no-git is passed. Default ON. */
  git?: boolean;
  ticket?: string;
  context?: boolean;
  /** Legacy alias - agent tools are now on by default. */
  mcpTools?: boolean;
  /** Commander negation - present and false when --no-tools is passed. */
  tools?: boolean;
}

export async function startDebateCommand(
  topic: string,
  options: StartDebateOptions,
): Promise<void> {
  await requireAuth();

  const mode =
    options.mode && isValidMode(options.mode) ? options.mode : getDefaultMode();
  const prefs = await getPreferences();
  const models = options.models?.length ? options.models : prefs.defaultAgents;
  const client = new ConsiliumClient();

  const wsContext = await loadWorkspaceContext({
    file: options.file,
    gitDiff: options.gitDiff,
    git: options.git,
    ticket: options.ticket,
    context: options.context,
  });

  const bridge = await startToolBridge(client, {
    // Tools default to ON; --no-tools (Commander -> options.tools === false)
    // is the explicit opt-out. The legacy --mcp-tools flag is preserved as
    // a no-op alias since on-by-default makes it redundant.
    enabled: options.tools !== false,
    quiet: options.json,
  });

  try {
    const { id } = await client.createDebate({
      topic,
      mode: mode as never,
      models,
      debateSource: "cli",
      files: wsContext?.files,
      projectFiles: wsContext?.projectFiles,
      projectContext: wsContext?.projectContext,
      tools: bridge?.tools,
      toolBudget: bridge?.toolBudget,
    });
    if (options.json) {
      console.log(
        JSON.stringify({
          id,
          mode,
          models,
          mcpTools: bridge?.tools.length ?? 0,
        }),
      );
    } else {
      console.log(st.success(`Debate queued: ${id}`));
      console.log(
        st.dim(`  Attach later with: consilium debates stream ${id}`),
      );
    }
    await bridge?.shutdown();
  } catch (err) {
    await bridge?.shutdown();
    if (err instanceof Error && "status" in err) {
      const status = (err as { status?: number }).status;
      if (status === 401 || status === 403) {
        console.error(st.error("Authentication failed. Run: consilium login"));
      } else {
        console.error(st.error(`Start failed: ${err.message}`));
      }
    } else {
      console.error(st.error(`Start failed: ${(err as Error).message}`));
    }
    process.exitCode = 1;
  }
}

export interface StreamDebateOptions {
  deliberation?: boolean;
  /** Legacy alias - agent tools are now on by default. */
  mcpTools?: boolean;
  /** Commander negation - present and false when --no-tools is passed. */
  tools?: boolean;
}

export async function streamDebateCommand(
  debateId: string,
  options: StreamDebateOptions = {},
): Promise<void> {
  await requireAuth();
  const client = new ConsiliumClient();

  const bridge = await startToolBridge(client, {
    enabled: options.tools !== false,
  });

  // The stream event callbacks are sync, so we can't await the
  // bridge's async handleEvent. Attach an explicit .catch() instead of
  // `void` so that postToolResult / registry.callTool failures
  // surface in the user's terminal as a warning rather than silently
  // becoming an unhandled rejection.
  const dispatchToBridge = (event: DebateEvent | DeliberationEvent) => {
    if (!bridge) return;
    bridge.handleEvent(event, debateId).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(st.warning(`[mcp] tool dispatch failed: ${message}`));
    });
  };

  const onDebateEvent = (event: DebateEvent) => {
    dispatchToBridge(event);
    const prefix = event.agent ? `[${event.agent}] ` : "";
    if (event.text) {
      process.stdout.write(prefix + event.text);
    } else if (event.type) {
      console.log(st.dim(`${prefix}${event.type}`));
    }
  };

  const onDeliberationEvent = (event: DeliberationEvent) => {
    dispatchToBridge(event);
    const prefix = event.agent ? `[${event.agent}] ` : "";
    if (event.text) {
      process.stdout.write(prefix + event.text);
    } else if (event.phase) {
      console.log(st.dim(`${prefix}phase=${event.phase}`));
    } else if (event.type) {
      console.log(st.dim(`${prefix}${event.type}`));
    }
  };

  try {
    if (options.deliberation) {
      await client.streamDeliberation(debateId, onDeliberationEvent);
    } else {
      await client.streamDebate(debateId, onDebateEvent);
    }
    console.log("");
    console.log(st.success("Stream completed."));
    await bridge?.shutdown();
  } catch (err) {
    await bridge?.shutdown();
    console.error(st.error(`Stream failed: ${(err as Error).message}`));
    process.exitCode = 1;
  }
}
