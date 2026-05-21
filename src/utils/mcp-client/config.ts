import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { McpServerConfig, McpServersFile } from "./types";

const USER_CONFIG_DIR = path.join(os.homedir(), ".consilium");
const USER_CONFIG_FILE = path.join(USER_CONFIG_DIR, "mcp-servers.json");

function emptyFile(): McpServersFile {
  return { servers: {} };
}

export function getConfigPath(): string {
  return USER_CONFIG_FILE;
}

export function loadServers(): McpServersFile {
  try {
    const raw = fs.readFileSync(USER_CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || !("servers" in parsed)) {
      return emptyFile();
    }
    const servers = (parsed as { servers?: unknown }).servers;
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
      return emptyFile();
    }
    return { servers: servers as McpServersFile["servers"] };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return emptyFile();
    throw err;
  }
}

export function saveServers(file: McpServersFile): void {
  if (!fs.existsSync(USER_CONFIG_DIR)) {
    fs.mkdirSync(USER_CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(USER_CONFIG_FILE, JSON.stringify(file, null, 2) + "\n", {
    mode: 0o600,
  });
}

export function listServers(): McpServerConfig[] {
  const file = loadServers();
  return Object.entries(file.servers).map(([name, cfg]) => ({
    name,
    ...cfg,
  }));
}

export function getServer(name: string): McpServerConfig | undefined {
  const file = loadServers();
  const cfg = file.servers[name];
  if (!cfg) return undefined;
  return { name, ...cfg };
}

export function addServer(config: McpServerConfig): void {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(config.name)) {
    throw new Error(
      `invalid server name "${config.name}" (must match [a-zA-Z][a-zA-Z0-9_-]*)`,
    );
  }
  if (!config.command || !config.command.trim()) {
    throw new Error("command is required");
  }
  const file = loadServers();
  if (file.servers[config.name]) {
    throw new Error(
      `server "${config.name}" already exists (use --force or \`remove\` first)`,
    );
  }
  file.servers[config.name] = stripName(config);
  saveServers(file);
}

export function upsertServer(config: McpServerConfig): void {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(config.name)) {
    throw new Error(`invalid server name "${config.name}"`);
  }
  const file = loadServers();
  file.servers[config.name] = stripName(config);
  saveServers(file);
}

export function removeServer(name: string): boolean {
  const file = loadServers();
  if (!file.servers[name]) return false;
  delete file.servers[name];
  saveServers(file);
  return true;
}

function stripName(config: McpServerConfig): Omit<McpServerConfig, "name"> {
  const { name: _name, ...rest } = config;
  return rest;
}
