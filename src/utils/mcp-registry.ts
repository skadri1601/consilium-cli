export type MCPCategory =
  | "productivity"
  | "dev-tools"
  | "data"
  | "communication"
  | "other";

export interface MCPServerEntry {
  name: string;
  displayName: string;
  description: string;
  category: MCPCategory;
  homepage: string;
  npmPackage?: string;
  pythonPackage?: string;
  configTemplate: Record<string, unknown>;
  envVars?: string[];
  tags: string[];
}

export const REGISTRY: MCPServerEntry[] = [
  {
    name: "github",
    displayName: "GitHub",
    description:
      "Repository, issue, pull request, and code-search tools backed by the GitHub REST API.",
    category: "dev-tools",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
    npmPackage: "@modelcontextprotocol/server-github",
    configTemplate: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PERSONAL_ACCESS_TOKEN}" },
      transport: "stdio",
    },
    envVars: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
    tags: ["git", "github", "repo", "issues", "pr", "code-search"],
  },
  {
    name: "filesystem",
    displayName: "Filesystem",
    description:
      "Read, write, and search files in allowlisted directories with safe path enforcement.",
    category: "dev-tools",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    npmPackage: "@modelcontextprotocol/server-filesystem",
    configTemplate: {
      command: "npx",
      args: [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "${ALLOWED_DIRECTORY}",
      ],
      transport: "stdio",
    },
    envVars: ["ALLOWED_DIRECTORY"],
    tags: ["files", "fs", "local", "read", "write"],
  },
  {
    name: "git",
    displayName: "Git",
    description:
      "Inspect repository history, diffs, branches, and commits via git CLI bindings.",
    category: "dev-tools",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/git",
    pythonPackage: "mcp-server-git",
    configTemplate: {
      command: "uvx",
      args: ["mcp-server-git", "--repository", "${GIT_REPOSITORY}"],
      transport: "stdio",
    },
    envVars: ["GIT_REPOSITORY"],
    tags: ["git", "vcs", "diff", "commits"],
  },
  {
    name: "postgres",
    displayName: "Postgres",
    description:
      "Run read-only SQL queries against a PostgreSQL database with schema introspection.",
    category: "data",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/postgres",
    npmPackage: "@modelcontextprotocol/server-postgres",
    configTemplate: {
      command: "npx",
      args: [
        "-y",
        "@modelcontextprotocol/server-postgres",
        "${POSTGRES_CONNECTION_STRING}",
      ],
      env: { POSTGRES_CONNECTION_STRING: "${POSTGRES_CONNECTION_STRING}" },
      transport: "stdio",
    },
    envVars: ["POSTGRES_CONNECTION_STRING"],
    tags: ["database", "sql", "postgres", "pg", "query"],
  },
  {
    name: "slack",
    displayName: "Slack",
    description:
      "Post messages, read channels, and manage Slack workspaces via the Slack Web API.",
    category: "communication",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/slack",
    npmPackage: "@modelcontextprotocol/server-slack",
    configTemplate: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-slack"],
      env: {
        SLACK_BOT_TOKEN: "${SLACK_BOT_TOKEN}",
        SLACK_TEAM_ID: "${SLACK_TEAM_ID}",
      },
      transport: "stdio",
    },
    envVars: ["SLACK_BOT_TOKEN", "SLACK_TEAM_ID"],
    tags: ["chat", "messaging", "slack", "channels"],
  },
  {
    name: "puppeteer",
    displayName: "Puppeteer",
    description:
      "Headless Chrome automation for browsing, screenshots, and DOM inspection.",
    category: "dev-tools",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer",
    npmPackage: "@modelcontextprotocol/server-puppeteer",
    configTemplate: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-puppeteer"],
      transport: "stdio",
    },
    tags: ["browser", "headless", "screenshot", "scraping", "automation"],
  },
  {
    name: "brave-search",
    displayName: "Brave Search",
    description:
      "Web search results powered by the Brave Search API for grounded answers.",
    category: "productivity",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search",
    npmPackage: "@modelcontextprotocol/server-brave-search",
    configTemplate: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-brave-search"],
      env: { BRAVE_API_KEY: "${BRAVE_API_KEY}" },
      transport: "stdio",
    },
    envVars: ["BRAVE_API_KEY"],
    tags: ["search", "web", "brave", "research"],
  },
  {
    name: "sqlite",
    displayName: "SQLite",
    description:
      "Query and modify SQLite databases over MCP with schema introspection.",
    category: "data",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite",
    npmPackage: "@modelcontextprotocol/server-sqlite",
    configTemplate: {
      command: "npx",
      args: [
        "-y",
        "@modelcontextprotocol/server-sqlite",
        "--db-path",
        "${SQLITE_DB_PATH}",
      ],
      transport: "stdio",
    },
    envVars: ["SQLITE_DB_PATH"],
    tags: ["database", "sql", "sqlite", "local"],
  },
  {
    name: "google-drive",
    displayName: "Google Drive",
    description:
      "Browse and read Google Drive documents, spreadsheets, and files via the Drive API.",
    category: "productivity",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/gdrive",
    npmPackage: "@modelcontextprotocol/server-gdrive",
    configTemplate: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-gdrive"],
      env: { GDRIVE_CREDENTIALS_PATH: "${GDRIVE_CREDENTIALS_PATH}" },
      transport: "stdio",
    },
    envVars: ["GDRIVE_CREDENTIALS_PATH"],
    tags: ["drive", "gdrive", "google", "files", "docs"],
  },
  {
    name: "everart",
    displayName: "EverArt",
    description:
      "Generate images via the EverArt API for design, mockups, and creative work.",
    category: "other",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/everart",
    npmPackage: "@modelcontextprotocol/server-everart",
    configTemplate: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-everart"],
      env: { EVERART_API_KEY: "${EVERART_API_KEY}" },
      transport: "stdio",
    },
    envVars: ["EVERART_API_KEY"],
    tags: ["image", "generation", "ai", "art", "everart"],
  },
  {
    name: "memory",
    displayName: "Memory",
    description:
      "Persistent knowledge graph store: remember entities, observations, and relations across sessions.",
    category: "productivity",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
    npmPackage: "@modelcontextprotocol/server-memory",
    configTemplate: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
      transport: "stdio",
    },
    tags: ["memory", "knowledge-graph", "state", "persistence"],
  },
  {
    name: "time",
    displayName: "Time",
    description:
      "Current time, time-zone conversion, and date arithmetic helpers for agents.",
    category: "productivity",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/time",
    pythonPackage: "mcp-server-time",
    configTemplate: {
      command: "uvx",
      args: ["mcp-server-time"],
      transport: "stdio",
    },
    tags: ["time", "date", "timezone", "clock"],
  },
];

export function findByName(name: string): MCPServerEntry | null {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  for (const entry of REGISTRY) {
    if (entry.name.toLowerCase() === needle) return entry;
  }
  return null;
}

interface ScoredEntry {
  entry: MCPServerEntry;
  score: number;
}

function scoreEntry(entry: MCPServerEntry, query: string): number {
  const q = query.toLowerCase();
  if (!q) return 0;
  const name = entry.name.toLowerCase();
  const display = entry.displayName.toLowerCase();
  const desc = entry.description.toLowerCase();
  const tags = entry.tags.map((t) => t.toLowerCase());

  let score = 0;
  if (name === q) score += 100;
  else if (name.startsWith(q)) score += 70;
  else if (name.includes(q)) score += 40;

  if (display.toLowerCase() === q) score += 60;
  else if (display.includes(q)) score += 25;

  if (tags.includes(q)) score += 35;
  else if (tags.some((t) => t.includes(q))) score += 15;

  if (desc.includes(q)) score += 10;

  return score;
}

export function searchRegistry(query: string): MCPServerEntry[] {
  const q = query.trim();
  if (!q) return [];
  const scored: ScoredEntry[] = [];
  for (const entry of REGISTRY) {
    const score = scoreEntry(entry, q);
    if (score > 0) scored.push({ entry, score });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.entry.name.localeCompare(b.entry.name);
  });
  return scored.map((s) => s.entry);
}
