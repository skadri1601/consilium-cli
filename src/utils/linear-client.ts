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

export interface LinearTeam {
  id: string;
  key: string;
  name: string;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  state: string;
  assignee: string | null;
  url?: string;
}

export interface LinearIssueDetail extends LinearIssue {
  description: string;
  priority: number;
  labels: string[];
  comments: Array<{ author: string; body: string }>;
}

export interface LinearUser {
  id: string;
  email: string;
  name: string;
}

export interface ListIssuesFilter {
  teamId?: string;
  assigneeIds?: string[];
  states?: string[];
}

export interface CreateIssueInput {
  teamId: string;
  title: string;
  description?: string;
  labelIds?: string[];
  assigneeId?: string;
}

export interface UpdateIssuePatch {
  stateId?: string;
  description?: string;
  labelIds?: string[];
  assigneeId?: string;
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

export class LinearClientError extends Error {
  public readonly reason?: unknown;
  constructor(message: string, reason?: unknown) {
    super(message);
    this.name = "LinearClientError";
    this.reason = reason;
  }
}

export class LinearClient {
  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new LinearClientError("Linear API key is required");
    }
  }

  private async request<T = unknown>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.apiKey,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new LinearClientError(
        `Linear API responded with ${response.status}`,
      );
    }
    const payload = (await response.json()) as {
      data?: T;
      errors?: Array<{ message: string }>;
    };
    if (payload.errors && payload.errors.length > 0) {
      const msg = payload.errors.map((e) => e.message).join("; ");
      throw new LinearClientError(`Linear GraphQL error: ${msg}`);
    }
    if (!payload.data) {
      throw new LinearClientError("Linear API returned no data");
    }
    return payload.data;
  }

  async whoAmI(): Promise<LinearUser> {
    const data = await this.request<{
      viewer: { id: string; email: string; name: string };
    }>(`query { viewer { id email name } }`);
    return {
      id: data.viewer.id,
      email: data.viewer.email,
      name: data.viewer.name,
    };
  }

  async getTeam(key: string): Promise<LinearTeam> {
    const data = await this.request<{
      teams: { nodes: Array<{ id: string; key: string; name: string }> };
    }>(
      `query ($key: String!) {
        teams(filter: { key: { eq: $key } }, first: 1) {
          nodes { id key name }
        }
      }`,
      { key },
    );
    const team = data.teams.nodes[0];
    if (!team) {
      throw new LinearClientError(`Linear team not found for key: ${key}`);
    }
    return team;
  }

  async listIssues(filter: ListIssuesFilter = {}): Promise<LinearIssue[]> {
    const issueFilter: Record<string, unknown> = {};
    if (filter.teamId) {
      issueFilter["team"] = { id: { eq: filter.teamId } };
    }
    if (filter.assigneeIds && filter.assigneeIds.length > 0) {
      issueFilter["assignee"] = { id: { in: filter.assigneeIds } };
    }
    if (filter.states && filter.states.length > 0) {
      issueFilter["state"] = { name: { in: filter.states } };
    }

    const data = await this.request<{
      issues: {
        nodes: Array<{
          id: string;
          identifier: string;
          title: string;
          url?: string;
          state?: { name?: string } | null;
          assignee?: { name?: string; email?: string } | null;
        }>;
      };
    }>(
      `query ($filter: IssueFilter) {
        issues(filter: $filter, first: 100, orderBy: updatedAt) {
          nodes {
            id
            identifier
            title
            url
            state { name }
            assignee { name email }
          }
        }
      }`,
      { filter: issueFilter },
    );

    return data.issues.nodes.map((node) => ({
      id: node.id,
      identifier: node.identifier,
      title: node.title,
      url: node.url,
      state: node.state?.name ?? "unknown",
      assignee: node.assignee?.name ?? node.assignee?.email ?? null,
    }));
  }

  async listMyIssues(): Promise<LinearIssue[]> {
    const me = await this.whoAmI();
    return this.listIssues({ assigneeIds: [me.id] });
  }

  async getIssue(identifier: string): Promise<LinearIssueDetail> {
    const normalized = normalizeIdentifier(identifier);
    const parts = normalized.split("-");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new LinearClientError(
        `Invalid Linear identifier: "${identifier}". Expected format like MYC-123 or 123.`,
      );
    }
    const teamKey = parts[0];
    const number = parseInt(parts[1], 10);
    if (Number.isNaN(number)) {
      throw new LinearClientError(
        `Invalid issue number in identifier: ${identifier}`,
      );
    }

    const data = await this.request<{
      issues: {
        nodes: Array<{
          id: string;
          identifier: string;
          title: string;
          description?: string | null;
          url?: string;
          priority?: number | null;
          state?: { name?: string } | null;
          assignee?: { name?: string; email?: string } | null;
          labels?: { nodes?: Array<{ name?: string }> } | null;
          comments?: {
            nodes?: Array<{
              body?: string;
              user?: { name?: string; email?: string } | null;
            }>;
          } | null;
        }>;
      };
    }>(
      `query ($filter: IssueFilter) {
        issues(filter: $filter, first: 1) {
          nodes {
            id
            identifier
            title
            description
            url
            priority
            state { name }
            assignee { name email }
            labels { nodes { name } }
            comments(first: 20) { nodes { body user { name email } } }
          }
        }
      }`,
      {
        filter: {
          team: { key: { eq: teamKey } },
          number: { eq: number },
        },
      },
    );

    const issue = data.issues.nodes[0];
    if (!issue) {
      throw new LinearClientError(`Issue not found: ${normalized}`);
    }
    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description ?? "",
      url: issue.url,
      priority: issue.priority ?? 0,
      state: issue.state?.name ?? "unknown",
      assignee: issue.assignee?.name ?? issue.assignee?.email ?? null,
      labels: (issue.labels?.nodes ?? [])
        .map((l) => l.name)
        .filter((n): n is string => Boolean(n)),
      comments: (issue.comments?.nodes ?? []).map((c) => ({
        author: c.user?.name ?? c.user?.email ?? "unknown",
        body: c.body ?? "",
      })),
    };
  }

  async createIssue(input: CreateIssueInput): Promise<LinearIssue> {
    const data = await this.request<{
      issueCreate: {
        success: boolean;
        issue: {
          id: string;
          identifier: string;
          title: string;
          url?: string;
          state?: { name?: string } | null;
          assignee?: { name?: string; email?: string } | null;
        };
      };
    }>(
      `mutation ($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id
            identifier
            title
            url
            state { name }
            assignee { name email }
          }
        }
      }`,
      {
        input: {
          teamId: input.teamId,
          title: input.title,
          ...(input.description !== undefined && {
            description: input.description,
          }),
          ...(input.labelIds &&
            input.labelIds.length > 0 && {
              labelIds: input.labelIds,
            }),
          ...(input.assigneeId && { assigneeId: input.assigneeId }),
        },
      },
    );
    if (!data.issueCreate.success) {
      throw new LinearClientError("Linear refused to create the issue");
    }
    const node = data.issueCreate.issue;
    return {
      id: node.id,
      identifier: node.identifier,
      title: node.title,
      url: node.url,
      state: node.state?.name ?? "unknown",
      assignee: node.assignee?.name ?? node.assignee?.email ?? null,
    };
  }

  async updateIssue(id: string, patch: UpdateIssuePatch): Promise<LinearIssue> {
    const input: Record<string, unknown> = {};
    if (patch.stateId) input["stateId"] = patch.stateId;
    if (patch.description !== undefined)
      input["description"] = patch.description;
    if (patch.labelIds) input["labelIds"] = patch.labelIds;
    if (patch.assigneeId) input["assigneeId"] = patch.assigneeId;

    const data = await this.request<{
      issueUpdate: {
        success: boolean;
        issue: {
          id: string;
          identifier: string;
          title: string;
          url?: string;
          state?: { name?: string } | null;
          assignee?: { name?: string; email?: string } | null;
        };
      };
    }>(
      `mutation ($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue {
            id
            identifier
            title
            url
            state { name }
            assignee { name email }
          }
        }
      }`,
      { id, input },
    );
    if (!data.issueUpdate.success) {
      throw new LinearClientError("Linear refused to update the issue");
    }
    const node = data.issueUpdate.issue;
    return {
      id: node.id,
      identifier: node.identifier,
      title: node.title,
      url: node.url,
      state: node.state?.name ?? "unknown",
      assignee: node.assignee?.name ?? node.assignee?.email ?? null,
    };
  }

  async addComment(issueId: string, body: string): Promise<void> {
    const data = await this.request<{
      commentCreate: { success: boolean };
    }>(
      `mutation ($input: CommentCreateInput!) {
        commentCreate(input: $input) { success }
      }`,
      { input: { issueId, body } },
    );
    if (!data.commentCreate.success) {
      throw new LinearClientError("Linear refused to add the comment");
    }
  }

  async findStateByName(
    teamId: string,
    name: string,
  ): Promise<{ id: string; name: string } | null> {
    const data = await this.request<{
      workflowStates: {
        nodes: Array<{ id: string; name: string }>;
      };
    }>(
      `query ($teamId: ID!) {
        workflowStates(filter: { team: { id: { eq: $teamId } } }, first: 50) {
          nodes { id name }
        }
      }`,
      { teamId },
    );
    const target = name.trim().toLowerCase();
    const match = data.workflowStates.nodes.find(
      (s) => s.name.toLowerCase() === target,
    );
    return match ?? null;
  }

  async findUserByEmail(email: string): Promise<LinearUser | null> {
    const data = await this.request<{
      users: { nodes: Array<{ id: string; email: string; name: string }> };
    }>(
      `query ($email: String!) {
        users(filter: { email: { eq: $email } }, first: 1) {
          nodes { id email name }
        }
      }`,
      { email },
    );
    return data.users.nodes[0] ?? null;
  }

  async findLabelByName(
    teamId: string,
    name: string,
  ): Promise<{ id: string; name: string } | null> {
    const data = await this.request<{
      issueLabels: { nodes: Array<{ id: string; name: string }> };
    }>(
      `query ($teamId: ID!) {
        issueLabels(filter: { team: { id: { eq: $teamId } } }, first: 100) {
          nodes { id name }
        }
      }`,
      { teamId },
    );
    const target = name.trim().toLowerCase();
    const match = data.issueLabels.nodes.find(
      (l) => l.name.toLowerCase() === target,
    );
    return match ?? null;
  }
}

export function normalizeIdentifier(
  input: string,
  defaultTeam = "MYC",
): string {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) {
    return `${defaultTeam}-${trimmed}`;
  }
  return trimmed.toUpperCase();
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
