import { ConsiliumClient } from "../api/client";
import { requireAuth } from "../utils/require-auth";
import {
  style,
  border,
  borderBottom,
  contentLine,
} from "../utils/visual-system";

const st = style();
const RESPONSE_TRUNCATE_LENGTH = 200;

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

function formatTimestamp(ts: string | undefined): string {
  if (!ts) return "N/A";
  return new Date(ts).toLocaleString();
}

function formatCost(cost: number | undefined): string {
  if (cost === undefined || cost === null) return "N/A";
  return `$${cost.toFixed(4)}`;
}

export async function debugCommand(debateId: string): Promise<void> {
  await requireAuth();

  const client = new ConsiliumClient();
  let debate: any;

  try {
    debate = await client.getDebateDetails(debateId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.log(st.error(`Failed to fetch debate: ${msg}`));
    process.exit(1);
  }

  console.log(border("Debate Trace"));
  console.log(contentLine(`ID:      ${debate.id || debateId}`));
  console.log(contentLine(`Topic:   ${debate.topic || "N/A"}`));
  console.log(contentLine(`Status:  ${debate.status || "N/A"}`));
  console.log(
    contentLine(`Models:  ${(debate.models || []).join(", ") || "N/A"}`),
  );
  console.log(
    contentLine(`Cost:    ${formatCost(debate.totalCost ?? debate.cost)}`),
  );
  console.log(contentLine(`Created: ${formatTimestamp(debate.createdAt)}`));
  console.log(borderBottom());

  if (debate.rounds?.length) {
    for (let i = 0; i < debate.rounds.length; i++) {
      const round = debate.rounds[i];
      console.log("");
      console.log(border(`Round ${i + 1}`));

      if (round.responses?.length) {
        for (const resp of round.responses) {
          const agentName = resp.agent || resp.model || "Agent";
          const rawText = resp.text || resp.response || "";
          const truncated = truncateText(
            rawText.replaceAll("\n", " "),
            RESPONSE_TRUNCATE_LENGTH,
          );
          console.log(contentLine(`${st.brand(agentName)}: ${truncated}`));
        }
      }

      console.log(borderBottom());
    }
  }

  const synthesis = debate.goldenPrompt || debate.synthesis || debate.consensus;
  if (synthesis) {
    console.log("");
    console.log(border("Golden Prompt Preview"));
    const preview = truncateText(
      synthesis.replaceAll("\n", " "),
      RESPONSE_TRUNCATE_LENGTH * 2,
    );
    console.log(contentLine(preview));
    console.log(borderBottom());
  }
}
