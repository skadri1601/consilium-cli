import readline from "node:readline";
import {
  LinearClient,
  LinearClientError,
  normalizeIdentifier,
  type LinearIssue,
  type LinearIssueDetail,
} from "../utils/linear-client.js";
import { loadConfig, saveConfig } from "../utils/config.js";
import { style } from "../utils/visual-system.js";
import { debateCommand, type DebateCommandOptions } from "./debate.js";

const st = style();

const DEFAULT_TEAM_KEY = "MYC";

export interface LinearCommandDeps {
  client?: LinearClient;
  debate?: (topic: string, options: DebateCommandOptions) => Promise<void>;
  prompt?: (question: string) => Promise<string>;
}

export interface LinearListOptions {
  mine?: boolean;
  state?: string;
  team?: string;
}

export interface LinearCreateOptions {
  description?: string;
  label?: string;
  assignee?: string;
  team?: string;
}

export interface LinearUpdateOptions {
  state?: string;
  description?: string;
  label?: string;
  assignee?: string;
  team?: string;
}

export interface LinearDebateOptions extends DebateCommandOptions {
  mode?: string;
  postComment?: boolean;
  team?: string;
}

function defaultPrompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    let answered = false;
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(answer);
    });
    rl.on("close", () => {
      if (!answered) resolve("");
    });
  });
}

function getApiKey(): string | undefined {
  const config = loadConfig();
  return (
    process.env.LINEAR_API_KEY ||
    ((config as Record<string, unknown>)["linearApiKey"] as string | undefined)
  );
}

async function resolveClient(
  deps: LinearCommandDeps,
  promptForKey: boolean,
): Promise<LinearClient | null> {
  if (deps.client) return deps.client;

  let apiKey = getApiKey();
  if (!apiKey && promptForKey) {
    const prompt = deps.prompt ?? defaultPrompt;
    console.log(
      st.warning(
        "No Linear API key found. Get one at https://linear.app/settings/api",
      ),
    );
    const entered = (
      await prompt("Paste Linear API key (or press Enter to cancel): ")
    ).trim();
    if (!entered) {
      console.log(st.error("Linear API key required. Aborted."));
      process.exitCode = 1;
      return null;
    }
    const save = (await prompt("Save key to ~/.consilium/config.json? (y/N) "))
      .trim()
      .toLowerCase();
    if (save === "y" || save === "yes") {
      const config = loadConfig();
      saveConfig({
        ...config,
        ...({ linearApiKey: entered } as Record<string, unknown>),
      } as ReturnType<typeof loadConfig>);
      console.log(st.dim("  Saved."));
    }
    apiKey = entered;
  }

  if (!apiKey) {
    console.log(
      st.error(
        "LINEAR_API_KEY not set. Get a key at https://linear.app/settings/api",
      ),
    );
    console.log(
      st.dim(
        "  Then: export LINEAR_API_KEY=lin_api_...  or  consilium config set linearApiKey lin_api_...",
      ),
    );
    process.exitCode = 1;
    return null;
  }

  return new LinearClient(apiKey);
}

function teamKey(opts: { team?: string }): string {
  return (opts.team || DEFAULT_TEAM_KEY).toUpperCase();
}

function pad(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width);
  return value + " ".repeat(width - value.length);
}

function renderIssueTable(issues: LinearIssue[]): void {
  if (issues.length === 0) {
    console.log(st.dim("  (no issues)"));
    return;
  }

  const idWidth = Math.max(8, ...issues.map((i) => i.identifier.length));
  const stateWidth = Math.max(8, ...issues.map((i) => i.state.length));
  const assigneeWidth = Math.max(
    8,
    ...issues.map((i) => (i.assignee ?? "—").length),
  );

  console.log(
    st.bold(
      `  ${pad("ID", idWidth)}  ${pad("State", stateWidth)}  ${pad("Assignee", assigneeWidth)}  Title`,
    ),
  );
  for (const issue of issues) {
    const title =
      issue.title.length > 80 ? issue.title.slice(0, 77) + "..." : issue.title;
    console.log(
      `  ${pad(issue.identifier, idWidth)}  ${pad(issue.state, stateWidth)}  ${pad(issue.assignee ?? "—", assigneeWidth)}  ${title}`,
    );
  }
}

function renderIssueDetail(issue: LinearIssueDetail): void {
  console.log(st.bold(`\n${issue.identifier}: ${issue.title}`));
  console.log(
    st.dim(
      `State: ${issue.state}   Priority: ${issue.priority}   Assignee: ${issue.assignee ?? "—"}`,
    ),
  );
  if (issue.url) console.log(st.dim(`URL: ${issue.url}`));
  if (issue.labels.length > 0) {
    console.log(st.dim(`Labels: ${issue.labels.join(", ")}`));
  }
  if (issue.description) {
    console.log("\n" + st.bold("Description:"));
    console.log(issue.description);
  }
  if (issue.comments.length > 0) {
    console.log("\n" + st.bold("Comments:"));
    for (const comment of issue.comments) {
      console.log(st.dim(`— ${comment.author}:`));
      console.log(comment.body);
      console.log("");
    }
  }
}

function handleClientError(err: unknown, action: string): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(st.error(`Failed to ${action}: ${msg}`));
  process.exitCode = 1;
}

export async function linearListCommand(
  options: LinearListOptions = {},
  deps: LinearCommandDeps = {},
): Promise<void> {
  const client = await resolveClient(deps, false);
  if (!client) return;

  try {
    let issues: LinearIssue[];
    if (options.mine) {
      issues = await client.listMyIssues();
    } else {
      const team = await client.getTeam(teamKey(options));
      issues = await client.listIssues({
        teamId: team.id,
        states: options.state ? [options.state] : undefined,
      });
    }

    if (options.state && options.mine) {
      const target = options.state.toLowerCase();
      issues = issues.filter((i) => i.state.toLowerCase() === target);
    }
    renderIssueTable(issues);
  } catch (err) {
    handleClientError(err, "list issues");
  }
}

export async function linearViewCommand(
  id: string,
  _options: { team?: string } = {},
  deps: LinearCommandDeps = {},
): Promise<void> {
  if (!id) {
    console.log(st.error("Usage: consilium linear view <id>"));
    process.exitCode = 1;
    return;
  }
  const client = await resolveClient(deps, false);
  if (!client) return;
  try {
    const issue = await client.getIssue(normalizeIdentifier(id));
    renderIssueDetail(issue);
  } catch (err) {
    handleClientError(err, "fetch issue");
  }
}

export async function linearCreateCommand(
  title: string,
  options: LinearCreateOptions = {},
  deps: LinearCommandDeps = {},
): Promise<void> {
  if (!title || !title.trim()) {
    console.log(st.error('Usage: consilium linear create "<title>"'));
    process.exitCode = 1;
    return;
  }
  const client = await resolveClient(deps, false);
  if (!client) return;

  try {
    const team = await client.getTeam(teamKey(options));
    let labelIds: string[] | undefined;
    if (options.label) {
      const label = await client.findLabelByName(team.id, options.label);
      if (!label) {
        console.log(
          st.warning(
            `Label "${options.label}" not found on team ${team.key}. Creating issue without label.`,
          ),
        );
      } else {
        labelIds = [label.id];
      }
    }
    let assigneeId: string | undefined;
    if (options.assignee) {
      const user = await client.findUserByEmail(options.assignee);
      if (!user) {
        console.log(
          st.warning(
            `Assignee "${options.assignee}" not found. Creating issue unassigned.`,
          ),
        );
      } else {
        assigneeId = user.id;
      }
    }

    const issue = await client.createIssue({
      teamId: team.id,
      title: title.trim(),
      ...(options.description !== undefined && {
        description: options.description,
      }),
      ...(labelIds && { labelIds }),
      ...(assigneeId && { assigneeId }),
    });
    console.log(st.success(`Created ${issue.identifier}: ${issue.title}`));
    if (issue.url) console.log(st.dim(issue.url));
  } catch (err) {
    handleClientError(err, "create issue");
  }
}

export async function linearUpdateCommand(
  id: string,
  options: LinearUpdateOptions = {},
  deps: LinearCommandDeps = {},
): Promise<void> {
  if (!id) {
    console.log(st.error("Usage: consilium linear update <id> [...flags]"));
    process.exitCode = 1;
    return;
  }
  const client = await resolveClient(deps, false);
  if (!client) return;

  try {
    const identifier = normalizeIdentifier(id);
    const issue = await client.getIssue(identifier);
    const team = await client.getTeam(
      identifier.split("-")[0] ?? teamKey(options),
    );

    const patch: Parameters<LinearClient["updateIssue"]>[1] = {};
    if (options.state) {
      const state = await client.findStateByName(team.id, options.state);
      if (!state) {
        console.log(
          st.error(
            `State "${options.state}" not found on team ${team.key}. Update aborted.`,
          ),
        );
        process.exitCode = 1;
        return;
      }
      patch.stateId = state.id;
    }
    if (options.description !== undefined) {
      patch.description = options.description;
    }
    if (options.label) {
      const label = await client.findLabelByName(team.id, options.label);
      if (!label) {
        console.log(
          st.error(
            `Label "${options.label}" not found on team ${team.key}. Update aborted.`,
          ),
        );
        process.exitCode = 1;
        return;
      }
      patch.labelIds = [label.id];
    }
    if (options.assignee) {
      const user = await client.findUserByEmail(options.assignee);
      if (!user) {
        console.log(
          st.error(`Assignee "${options.assignee}" not found. Update aborted.`),
        );
        process.exitCode = 1;
        return;
      }
      patch.assigneeId = user.id;
    }

    if (Object.keys(patch).length === 0) {
      console.log(
        st.warning(
          "Nothing to update. Pass --state, --description, --label, or --assignee.",
        ),
      );
      return;
    }

    const updated = await client.updateIssue(issue.id, patch);
    console.log(st.success(`Updated ${updated.identifier}: ${updated.title}`));
    console.log(
      st.dim(`  state=${updated.state}  assignee=${updated.assignee ?? "—"}`),
    );
  } catch (err) {
    handleClientError(err, "update issue");
  }
}

export async function linearDebateCommand(
  id: string,
  options: LinearDebateOptions = {},
  deps: LinearCommandDeps = {},
): Promise<void> {
  if (!id) {
    console.log(st.error("Usage: consilium linear debate <id>"));
    process.exitCode = 1;
    return;
  }
  const client = await resolveClient(deps, false);
  if (!client) return;

  let issue: LinearIssueDetail;
  try {
    issue = await client.getIssue(normalizeIdentifier(id));
  } catch (err) {
    handleClientError(err, "fetch issue");
    return;
  }

  const topicParts = [
    `# ${issue.identifier}: ${issue.title}`,
    "",
    `State: ${issue.state} · Priority: ${issue.priority} · Assignee: ${issue.assignee ?? "—"}`,
  ];
  if (issue.labels.length > 0) {
    topicParts.push(`Labels: ${issue.labels.join(", ")}`);
  }
  if (issue.description) {
    topicParts.push("", issue.description);
  }
  const topic = topicParts.join("\n");

  const debateFn = deps.debate ?? debateCommand;
  const { postComment, ...rest } = options;
  const debateOptions: DebateCommandOptions = {
    ...rest,
    mode: options.mode ?? "council",
    ticket: issue.identifier,
  };

  try {
    await debateFn(topic, debateOptions);
  } catch (err) {
    handleClientError(err, "run debate");
    return;
  }

  if (postComment) {
    console.log(
      st.dim(
        "  --post-comment: synthesis posting requires a captured synthesis. Wire SSE capture in to enable this.",
      ),
    );
  }
}

export function linearCommandSummary(): string {
  return [
    "consilium linear list [--mine] [--state <state>]",
    "consilium linear view <id>",
    'consilium linear create "<title>" [--description <text>] [--label <label>] [--assignee <email>]',
    "consilium linear update <id> [--state <state>] [--description <text>] [--label <label>] [--assignee <email>]",
    "consilium linear debate <id> [--mode <mode>] [--post-comment]",
  ].join("\n");
}
