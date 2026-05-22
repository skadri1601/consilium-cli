import {
  findSubAgent,
  invokeSubAgent,
  loadUserSubAgents,
  getUserSubAgentsDir,
} from "../sub-agents/loader";
import { style as st } from "../utils/visual-system";

export async function subAgentsListCommand(): Promise<void> {
  const agents = await loadUserSubAgents();
  if (agents.length === 0) {
    console.log(
      st.dim(
        `No user sub-agents found. Drop markdown files into ${getUserSubAgentsDir()}/`,
      ),
    );
    return;
  }
  console.log(st.bold(`Found ${agents.length} user sub-agent(s):\n`));
  for (const a of agents) {
    console.log(`  ${st.brand(a.name)}`);
    console.log(`    ${a.description}`);
    if (a.model) console.log(st.dim(`    model: ${a.model}`));
    if (a.allowedTools && a.allowedTools.length > 0) {
      console.log(st.dim(`    tools: ${a.allowedTools.join(", ")}`));
    }
    console.log();
  }
}

export async function subAgentsRunCommand(
  name: string,
  prompt: string,
): Promise<void> {
  const agent = await findSubAgent(name);
  if (!agent) {
    console.error(st.error(`Sub-agent "${name}" not found.`));
    console.error(
      st.dim(`Run \`consilium sub-agents list\` to see available agents.`),
    );
    process.exit(1);
  }
  try {
    const result = await invokeSubAgent(name, prompt);
    console.log(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(st.error(`Sub-agent invocation failed: ${msg}`));
    process.exit(1);
  }
}
