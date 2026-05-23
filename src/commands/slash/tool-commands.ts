import type { SlashResult } from "./shared-state.js";
import { style } from "../../utils/visual-system.js";

const st = style();

export async function slashTrust(args: string[]): Promise<SlashResult> {
  const sub = (args[0] ?? "status").toLowerCase();
  const trustMod = await import("../../utils/workspace-trust.js");

  if (sub === "list") {
    const entries = trustMod.listTrustedPaths();
    if (entries.length === 0) {
      console.log(st.dim("\nNo trusted workspaces.\n"));
      return "continue";
    }
    console.log(st.bold("\nTrusted workspaces\n"));
    for (const entry of entries) {
      const ts = new Date(entry.trustedAt).toLocaleString();
      console.log(
        st.brand(entry.path),
        st.dim(`  level=${entry.level} since ${ts}`),
      );
    }
    console.log("");
    return "continue";
  }

  if (sub === "add") {
    const target = args[1];
    if (!target) {
      console.log(st.warning("Usage: /trust add <path> [session|always]"));
      return "continue";
    }
    const levelArg = (args[2] ?? "always").toLowerCase();
    const level = levelArg === "session" ? "session" : ("always" as const);
    trustMod.trustPath(target, level);
    console.log(st.success(`Trusted ${target} (${level}).\n`));
    return "continue";
  }

  if (sub === "remove" || sub === "rm") {
    const target = args[1];
    if (!target) {
      console.log(st.warning("Usage: /trust remove <path>"));
      return "continue";
    }
    trustMod.untrustPath(target);
    console.log(st.success(`Removed trust for ${target}.\n`));
    return "continue";
  }

  if (sub === "status") {
    const cwd = process.cwd();
    const level = trustMod.getTrustLevel(cwd);
    console.log(st.bold("\nWorkspace trust\n"));
    console.log(st.brand("CWD:"), cwd);
    if (level) {
      console.log(st.brand("Trust:"), st.success(level));
    } else {
      console.log(st.brand("Trust:"), st.dim("not set"));
    }
    console.log("");
    return "continue";
  }

  console.log(
    st.dim(
      "Usage: /trust list | /trust add <path> [session|always] | /trust remove <path> | /trust status\n",
    ),
  );
  return "continue";
}

export async function slashVerify(args: string[]): Promise<SlashResult> {
  const url = args[0];
  if (!url) {
    console.log(st.warning("Usage: /verify <url> [selector]"));
    return "continue";
  }
  const selector = args[1];
  try {
    const { runVerify } = await import("../../utils/verify-runner.js");
    const r = await runVerify({ url, selector });
    console.log(st.success(`Screenshot saved: ${r.screenshotPath}`));
    if (r.videoPath) console.log(st.dim(`Video: ${r.videoPath}`));
    console.log(st.dim(`Page: ${r.domSummary}`));
    console.log(st.dim(`Duration: ${r.durationMs}ms\n`));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(st.error(msg));
  }
  return "continue";
}

export async function slashDream(args: string[]): Promise<SlashResult> {
  const prompt = args.join(" ").trim();
  if (!prompt) {
    console.log(st.warning("Usage: /dream <prompt>"));
    return "continue";
  }
  console.log(st.dim("Generating image..."));
  try {
    const { generateImage } = await import("../../utils/image-gen-client.js");
    const r = await generateImage({ prompt });
    console.log(st.success(`Image saved: ${r.filePath}`));
    if (r.revisedPrompt) {
      console.log(st.dim(`Revised prompt: ${r.revisedPrompt}`));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(st.error(msg));
  }
  return "continue";
}

export async function slashSubAgent(args: string[]): Promise<SlashResult> {
  const { subAgentsListCommand, subAgentsRunCommand } =
    await import("../sub-agents.js");
  if (args.length === 0 || args[0] === "list") {
    await subAgentsListCommand();
    return "continue";
  }
  const name = args[0];
  const prompt = args.slice(1).join(" ").trim();
  if (!name || !prompt) {
    console.log(st.warning("Usage: /sub-agent <name> <prompt>"));
    return "continue";
  }
  await subAgentsRunCommand(name, prompt);
  return "continue";
}

export async function slashBatch(args: string[]): Promise<SlashResult> {
  if (args.length < 2 || !/^\d+$/.test(args[0] ?? "")) {
    console.log(st.warning("Usage: /batch <N> <task description>"));
    return "continue";
  }
  const count = parseInt(args[0]!, 10);
  const topic = args.slice(1).join(" ").trim();
  if (count < 1 || count > 30) {
    console.log(st.error("Batch count must be 1..30"));
    return "continue";
  }
  if (!topic) {
    console.log(st.warning("Usage: /batch <N> <task description>"));
    return "continue";
  }
  console.log(st.dim(`Spawning ${count} batch worker(s)...`));
  try {
    const { runBatch } = await import("../../utils/batch-executor.js");
    const results = await runBatch({ count, topic, openPRs: false });
    for (const r of results) {
      const marker =
        r.status === "success" ? st.success("ok") : st.error(r.status);
      console.log(
        `${marker} ${r.task.id}: ${r.task.worktreePath} (${r.durationMs}ms)`,
      );
      if (r.prUrl) console.log(st.dim(`  PR: ${r.prUrl}`));
      if (r.error) console.log(st.dim(`  ${r.error}`));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(st.error(`Batch failed: ${msg}`));
  }
  return "continue";
}

export async function slashSimplify(): Promise<SlashResult> {
  console.log(st.dim("Running simplify review with 3 parallel reviewers..."));
  const { runSimplify } = await import("../../utils/simplify-runner.js");
  const { getGitDiff } = await import("../../utils/git-context.js");
  const diff = getGitDiff();
  if (!diff) {
    console.log(st.warning("No recent edits to review (git diff empty)"));
    return "continue";
  }
  try {
    const result = await runSimplify({ recentEdits: diff });
    console.log(st.bold(`\nFindings (${result.findings.length}):`));
    for (const f of result.findings) {
      const sev =
        f.severity === "critical"
          ? st.error(f.severity)
          : f.severity === "major"
            ? st.warning(f.severity)
            : st.dim(f.severity);
      const loc = f.file ? `${f.file}${f.line ? ":" + f.line : ""} ` : "";
      console.log(`  [${sev}] ${f.reviewer}: ${loc}${f.message}`);
    }
    if (result.consensusFixes.length > 0) {
      console.log(st.bold("\nConsensus fixes:"));
      for (const fix of result.consensusFixes) {
        console.log(`  - ${fix}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(st.error(`Simplify failed: ${msg}`));
  }
  return "continue";
}
