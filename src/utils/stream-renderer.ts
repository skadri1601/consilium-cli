import wrapAnsi from "wrap-ansi";
import { DebateEvent } from "../api/client";
import {
  border,
  borderBottom,
  borderLine,
  contentLine,
  borderRounded,
  borderBottomRounded,
  borderLineRounded,
  contentLineRounded,
  style,
} from "./visual-system";
import { typography } from "./typography";
import { terminal } from "./terminal-capabilities";
import { updateLine, stopUpdates } from "./animation-controller";

const st = style();
const W = () => terminal.width;
const BAR_LEN = 24;

interface AgentCardState {
  name: string;
  status: "thinking" | "done";
  content: string;
  startTime: number;
  durationMs?: number;
}

function progressBar(percent: number, durationSec?: number): string {
  const filled = Math.round(
    (BAR_LEN * Math.min(100, Math.max(0, percent))) / 100,
  );
  const bar = "█".repeat(filled) + "░".repeat(BAR_LEN - filled);
  const pct = `${Math.round(percent)}%`;
  const time = durationSec === undefined ? "" : ` • ${durationSec.toFixed(1)}s`;
  return `[${bar}] ${pct}${time}`;
}

function renderAgentCard(card: AgentCardState, w: number): string[] {
  const statusLine =
    card.status === "done"
      ? `${st.success("✓")} Complete`
      : `${st.dim("⠸")} Analyzing...`;

  const contentW = w - 4;
  const wrapped = wrapAnsi(card.content || "", contentW, { hard: true });
  const contentLines = wrapped ? wrapped.split("\n") : [];
  const bodyLines = contentLines
    .slice(0, 20)
    .map((line) => contentLineRounded(line || " ", w));
  if (contentLines.length > 20) {
    bodyLines.push(contentLineRounded("…", w));
  }

  const percent =
    card.status === "done"
      ? 100
      : Math.min(95, ((Date.now() - card.startTime) / 1000) * 25);
  const durationSec =
    card.durationMs === undefined ? undefined : card.durationMs / 1000;

  return [
    borderRounded(card.name, w),
    borderLineRounded(w),
    contentLineRounded(statusLine, w),
    contentLineRounded("", w),
    ...bodyLines,
    contentLineRounded("", w),
    contentLineRounded(progressBar(percent, durationSec), w),
    borderBottomRounded(w),
  ];
}

export interface StreamRenderOptions {
  onComplete?: () => void;
  topic?: string;
}

export function createStreamHandlers(options: StreamRenderOptions = {}) {
  let topic = "";
  let agentCount = 0;
  const agents: AgentCardState[] = [];
  let currentIndex = -1;
  let consensusText = "";
  let completionNotified = false;
  const useLiveUpdate = terminal.isTTY && !terminal.usePlain;

  function buildFrame(): string {
    const w = W();
    const agentPart = agentCount > 0 ? `Agents: ${agentCount}` : "Agents: …";
    const statusPart = consensusText ? "Complete" : "In Progress";
    const parts: string[] = [
      st.dim("\n" + border("Consilium Debate", w)),
      contentLine(
        `  Topic: ${(topic || "…").slice(0, 50)}${topic.length > 50 ? "…" : ""}`,
        w,
      ),
      contentLine(`  ${agentPart} • Status: ${statusPart}`, w),
      st.dim(borderBottom(w)) + "\n",
    ];

    for (const card of agents) {
      parts.push(renderAgentCard(card, w).join("\n") + "\n");
    }

    if (consensusText) {
      const synLines = consensusText
        .split(/\n/)
        .map((line) => contentLine(line || " ", w));
      parts.push(
        st.dim(border("Synthesis", w)),
        borderLine(w),
        ...synLines,
        st.dim(borderBottom(w)) + "\n",
      );
    }

    return parts.join("\n");
  }

  function flushFinal() {
    if (!useLiveUpdate) return;
    stopUpdates();
    const w = W();
    const parts: string[] = [
      st.dim("\n" + border("Consilium Debate", w)),
      contentLine(`  Topic: ${(topic || "…").slice(0, 60)}`, w),
      contentLine(`  Agents: ${agents.length} • Status: Complete`, w),
      st.dim(borderBottom(w)) + "\n",
    ];
    for (const card of agents) {
      parts.push(renderAgentCard(card, w).join("\n") + "\n");
    }
    if (consensusText) {
      const synLines = consensusText
        .split(/\n/)
        .map((line) => contentLine(line || " ", w));
      parts.push(
        st.dim(border("Synthesis", w)),
        borderLine(w),
        ...synLines,
        st.dim(borderBottom(w)) + "\n",
      );
    }
    process.stdout.write(parts.join("\n"));
  }

  function onDebateStart(event: DebateEvent): void {
    topic = event.text || options.topic || "";
    if (useLiveUpdate) return;
    console.log(st.dim("\n" + border("Consilium Debate", W())));
    console.log(borderLine(W()));
    console.log(contentLine(`  Topic: ${(topic || "…").slice(0, 60)}`, W()));
    console.log(contentLine("  Agents: … • Status: In Progress", W()));
    console.log(st.dim(borderBottom(W())) + "\n");
  }

  function onAgentStart(event: DebateEvent): void {
    const name = event.agent || "Unknown";
    agentCount = Math.max(agentCount, agents.length + 1);
    agents.push({
      name,
      status: "thinking",
      content: "",
      startTime: Date.now(),
    });
    currentIndex = agents.length - 1;
    if (useLiveUpdate) {
      updateLine(buildFrame());
      return;
    }
    const label = (event.agent || "Unknown").padEnd(22);
    console.log(typography.agent("  ⠸ " + label) + st.dim(" thinking…"));
    console.log(st.dim("  │ "));
  }

  function onAgentChunk(event: DebateEvent): void {
    if (!event.text || currentIndex < 0 || currentIndex >= agents.length)
      return;
    const chunkCard = agents[currentIndex];
    if (!chunkCard) return;
    chunkCard.content += event.text;
    if (useLiveUpdate) {
      updateLine(buildFrame());
      return;
    }
    process.stdout.write(st.dim(event.text));
  }

  function onAgentComplete(): void {
    const card =
      currentIndex >= 0 && currentIndex < agents.length
        ? agents[currentIndex]
        : undefined;
    if (card) {
      card.status = "done";
      card.durationMs = Date.now() - card.startTime;
    }
    if (useLiveUpdate) {
      updateLine(buildFrame());
    } else {
      const label = (agents[currentIndex]?.name || "Unknown").padEnd(22);
      console.log(st.dim("  └─ ") + st.success("✓ " + label + " done"));
      console.log("");
    }
    currentIndex = -1;
  }

  function onConsensus(event: DebateEvent): void {
    if (event.text) consensusText = event.text;
    if (useLiveUpdate) {
      flushFinal();
      process.stdout.write(st.success("  ✓ Debate complete.\n\n"));
    } else {
      console.log(st.dim("\n" + border("Synthesis", W())));
      console.log(borderLine(W()));
      for (const line of (event.text || "").split(/\n/)) {
        console.log(contentLine(line || " ", W()));
      }
      console.log(st.dim(borderBottom(W())) + "\n");
      console.log(st.success("  ✓ Debate complete.\n"));
    }
    if (!completionNotified) {
      completionNotified = true;
      options.onComplete?.();
    }
  }

  function onDone(): void {
    if (useLiveUpdate && !consensusText) flushFinal();
    if (!useLiveUpdate) console.log(st.success("  ✓ Debate complete.\n"));
    if (!completionNotified) {
      completionNotified = true;
      options.onComplete?.();
    }
  }

  function onError(event: DebateEvent): void {
    if (useLiveUpdate) stopUpdates();
    console.log(
      st.error("\n  ✗ Error: " + (event.error || "Unknown error") + "\n"),
    );
    throw new Error(event.error || "Unknown error");
  }

  return function handleEvent(event: DebateEvent): void {
    switch (event.type) {
      case "debate_start":
        onDebateStart(event);
        break;
      case "agent_start":
        onAgentStart(event);
        break;
      case "agent_chunk":
        onAgentChunk(event);
        break;
      case "agent_complete":
        onAgentComplete();
        break;
      case "consensus":
        onConsensus(event);
        break;
      case "done":
        onDone();
        break;
      case "error":
        onError(event);
        break;
      default:
        break;
    }
  };
}
