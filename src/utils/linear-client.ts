import { loadConfig } from "./config";

export interface LinearTicket {
  id: string;
  identifier: string;
  title: string;
  description: string;
  state: string;
  priority: number;
  labels: string[];
  comments: string[];
}

async function linearApiQuery(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<any> {
  const config = loadConfig();
  const apiKey = process.env.LINEAR_API_KEY || (config as any).linearApiKey;
  if (!apiKey) return null;

  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) return null;
  const payload = (await response.json()) as { data?: unknown };
  return payload.data;
}

export async function fetchTicket(
  identifier: string,
): Promise<LinearTicket | null> {
  const parts = identifier.split("-");
  if (parts.length !== 2) return null;
  const teamKey = parts[0];
  const numberPart = parts[1];
  if (!teamKey || !numberPart) return null;

  const data = (await linearApiQuery(
    `query ($filter: IssueFilter) {
      issues(filter: $filter, first: 1) {
        nodes {
          id
          identifier
          title
          description
          state { name }
          priority
          labels { nodes { name } }
          comments { nodes { body } }
        }
      }
    }`,
    {
      filter: {
        team: { key: { eq: teamKey } },
        number: { eq: parseInt(numberPart, 10) },
      },
    },
  )) as
    | {
        issues?: {
          nodes?: Array<{
            id: string;
            identifier: string;
            title: string;
            description?: string | null;
            state?: { name?: string | null } | null;
            priority?: number | null;
            labels?: { nodes?: Array<{ name?: string }> | null } | null;
            comments?: { nodes?: Array<{ body?: string }> | null } | null;
          }>;
        };
      }
    | null
    | undefined;

  const issue = data?.issues?.nodes?.[0];
  if (!issue) return null;

  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description || "",
    state: issue.state?.name || "unknown",
    priority: issue.priority || 0,
    labels: (issue.labels?.nodes || []).map((l: any) => l.name),
    comments: (issue.comments?.nodes || []).slice(0, 5).map((c: any) => c.body),
  };
}

export function formatTicketForPrompt(ticket: LinearTicket): string {
  const parts: string[] = [
    "=== LINEAR TICKET ===",
    `${ticket.identifier}: ${ticket.title}`,
    `Status: ${ticket.state} | Priority: ${ticket.priority}`,
  ];
  if (ticket.labels.length > 0) {
    parts.push(`Labels: ${ticket.labels.join(", ")}`);
  }
  if (ticket.description) {
    parts.push("", "Description:", ticket.description);
  }
  if (ticket.comments.length > 0) {
    parts.push("", "Comments:");
    for (const comment of ticket.comments) {
      parts.push(`- ${comment.slice(0, 500)}`);
    }
  }
  parts.push("=== END LINEAR TICKET ===\n");
  return parts.join("\n");
}
