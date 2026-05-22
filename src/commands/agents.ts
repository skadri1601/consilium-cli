import fs from "node:fs";
import { Command } from "commander";
import { style } from "../utils/visual-system.js";
import {
  AgentRecord,
  getAgent,
  listAgents,
  removeAgent,
} from "../utils/agent-registry.js";
import {
  attachToAgent,
  readLogOnce,
  respawnAgent,
  stopAgent,
  tailLogFile,
} from "../utils/agent-supervisor.js";

const st = style();

function formatRelative(ts: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
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

function statusLabel(record: AgentRecord): string {
  if (record.status === "running") return st.success("running");
  if (record.status === "killed") return st.warning("killed");
  if (record.status === "exited") {
    if (record.exitCode !== undefined && record.exitCode !== 0) {
      return st.error(`exited(${record.exitCode})`);
    }
    return st.dim("exited");
  }
  return record.status;
}

export async function agentsListCommand(
  opts: {
    json?: boolean;
  } = {},
): Promise<void> {
  const agents = listAgents();
  if (opts.json) {
    console.log(JSON.stringify(agents, null, 2));
    return;
  }
  if (agents.length === 0) {
    console.log(st.dim("No background agents recorded."));
    console.log(st.dim('Start one with: consilium debate "topic" --bg'));
    return;
  }
  console.log(
    st.bold(`\n${agents.length} agent${agents.length === 1 ? "" : "s"}\n`),
  );
  for (const a of agents) {
    const argsStr = truncate(a.args.join(" "), 60);
    console.log(st.brand(`  ${a.id}`));
    console.log(`    ${a.command}  ${argsStr}`);
    console.log(
      st.dim(
        `    ${statusLabel(a)}  pid=${a.pid}  started=${formatRelative(a.startedAt)}`,
      ),
    );
  }
  console.log("");
  console.log(
    st.dim(
      "  consilium agents attach <id>   consilium agents logs <id> [-f]   consilium agents stop <id>",
    ),
  );
  console.log("");
}

export async function agentsAttachCommand(id: string): Promise<void> {
  const record = getAgent(id);
  if (!record) {
    console.error(st.error(`Agent not found: ${id}`));
    process.exitCode = 1;
    return;
  }
  console.log(
    st.dim(
      `Attached to agent ${record.id} (pid ${record.pid}). Ctrl+C to detach.`,
    ),
  );
  await attachToAgent(id);
  console.log(st.dim("\nDetached."));
}

export async function agentsStopCommand(id: string): Promise<void> {
  const record = getAgent(id);
  if (!record) {
    console.error(st.error(`Agent not found: ${id}`));
    process.exitCode = 1;
    return;
  }
  if (record.status !== "running") {
    console.log(st.dim(`Agent ${id} is not running (${record.status}).`));
    return;
  }
  try {
    await stopAgent(id);
    console.log(st.success(`Stopped agent ${id}.`));
  } catch (err) {
    console.error(st.error(`Failed to stop agent: ${(err as Error).message}`));
    process.exitCode = 1;
  }
}

export async function agentsLogsCommand(
  id: string,
  opts: { follow?: boolean } = {},
): Promise<void> {
  const record = getAgent(id);
  if (!record) {
    console.error(st.error(`Agent not found: ${id}`));
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(record.logPath)) {
    console.log(st.dim("(no log output yet)"));
    if (!opts.follow) return;
  }
  if (opts.follow) {
    await tailLogFile(record.logPath, () => {
      const fresh = getAgent(id);
      return fresh ? fresh.status !== "running" : true;
    });
    return;
  }
  await readLogOnce(id);
}

export async function agentsRespawnCommand(id: string): Promise<void> {
  const record = getAgent(id);
  if (!record) {
    console.error(st.error(`Agent not found: ${id}`));
    process.exitCode = 1;
    return;
  }
  try {
    const next = await respawnAgent(id);
    console.log(st.success(`Respawned ${id} as ${next.id} (pid ${next.pid}).`));
    console.log(
      st.dim(
        `  consilium agents attach ${next.id}   consilium agents logs ${next.id} -f`,
      ),
    );
  } catch (err) {
    console.error(
      st.error(`Failed to respawn agent: ${(err as Error).message}`),
    );
    process.exitCode = 1;
  }
}

export async function agentsRemoveCommand(id: string): Promise<void> {
  const record = getAgent(id);
  if (!record) {
    console.error(st.error(`Agent not found: ${id}`));
    process.exitCode = 1;
    return;
  }
  if (record.status === "running") {
    console.error(
      st.error(
        `Agent ${id} is still running; stop it first with 'agents stop'.`,
      ),
    );
    process.exitCode = 1;
    return;
  }
  removeAgent(id);
  console.log(st.success(`Removed agent ${id}.`));
}

export function registerAgentsCommand(program: Command): Command {
  const agents = program
    .command("agents")
    .description("Manage detached background debate agents");

  agents
    .command("list")
    .description("List background agents")
    .option("--json", "Emit as JSON")
    .action((opts: { json?: boolean }) => agentsListCommand(opts));

  agents
    .command("attach <id>")
    .description("Attach to a running agent's log stream (Ctrl+C to detach)")
    .action((id: string) => agentsAttachCommand(id));

  agents
    .command("detach <id>")
    .description("(alias) Does nothing on its own; Ctrl+C while attached")
    .action(() => {
      console.log(
        st.dim(
          "Detach is implicit. Press Ctrl+C while attached to leave the log tail.",
        ),
      );
    });

  agents
    .command("stop <id>")
    .description("Send SIGTERM (then SIGKILL after 5s) to a background agent")
    .action((id: string) => agentsStopCommand(id));

  agents
    .command("logs <id>")
    .description("Print the agent's log file")
    .option("-f, --follow", "Follow the log (like tail -f)")
    .action((id: string, opts: { follow?: boolean }) =>
      agentsLogsCommand(id, opts),
    );

  agents
    .command("respawn <id>")
    .description("Re-run an agent with the same args, producing a new id")
    .action((id: string) => agentsRespawnCommand(id));

  agents
    .command("rm <id>")
    .description("Remove an exited agent from the registry")
    .action((id: string) => agentsRemoveCommand(id));

  return agents;
}
