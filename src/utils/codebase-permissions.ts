import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const PERMISSIONS_FILE = path.join(
  os.homedir(),
  ".consilium",
  "permissions.json",
);
const STORE_VERSION = 2;

export type ReadPermissionLevel = "deny" | "session" | "always";
export type WritePermissionLevel = "deny" | "one-time" | "session" | "always";
type PersistedReadPermission = "deny" | "always";
type PersistedWritePermission = "deny" | "always";

interface ProjectPermissionEntry {
  readCodebase?: PersistedReadPermission;
  writeFiles?: PersistedWritePermission;
  grantedAt?: string;
  updatedAt?: string;
}

interface PermissionStore {
  version: number;
  projects: Record<string, ProjectPermissionEntry>;
}

interface LegacyBooleanEntry {
  granted?: boolean;
  grantedAt?: string;
}

interface LegacyNestedEntry {
  level?: "deny" | "session" | "always";
  grantedAt?: string;
}

interface PermissionMatch {
  scopePath: string;
  level: ReadPermissionLevel | WritePermissionLevel;
}

const readSessionPermissions = new Map<string, ReadPermissionLevel>();
const writeSessionPermissions = new Map<string, WritePermissionLevel>();
const writeOneTimePermissions = new Set<string>();

function normalizeScope(scopePath: string): string {
  return path.resolve(scopePath);
}

function ensureDirExists(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function isPathInside(candidate: string, scopePath: string): boolean {
  return candidate === scopePath || candidate.startsWith(scopePath + path.sep);
}

function findMostSpecificScope(
  targetPath: string,
  scopes: Iterable<string>,
): string | null {
  let best: string | null = null;
  for (const scope of scopes) {
    if (!isPathInside(targetPath, scope)) continue;
    if (!best || scope.length > best.length) {
      best = scope;
    }
  }
  return best;
}

function emptyStore(): PermissionStore {
  return { version: STORE_VERSION, projects: {} };
}

function migrateLegacyBooleanStore(
  raw: Record<string, LegacyBooleanEntry>,
): PermissionStore {
  const migrated = emptyStore();
  for (const [scope, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== "object") continue;
    const normalized = normalizeScope(scope);
    const granted = entry.granted === true;
    migrated.projects[normalized] = {
      readCodebase: granted ? "always" : "deny",
      writeFiles: "deny",
      grantedAt: entry.grantedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  return migrated;
}

function migrateLegacyNestedStore(raw: {
  permissions?: Record<string, LegacyNestedEntry>;
}): PermissionStore {
  const migrated = emptyStore();
  const permissions = raw.permissions || {};
  for (const [scope, entry] of Object.entries(permissions)) {
    const normalized = normalizeScope(scope);
    const readLevel = entry?.level === "always" ? "always" : "deny";
    migrated.projects[normalized] = {
      readCodebase: readLevel,
      writeFiles: "deny",
      grantedAt: entry?.grantedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  return migrated;
}

function normalizeStore(raw: unknown): PermissionStore {
  if (!raw || typeof raw !== "object") {
    return emptyStore();
  }

  const parsed = raw as Record<string, unknown>;
  if (
    parsed.version === STORE_VERSION &&
    parsed.projects &&
    typeof parsed.projects === "object"
  ) {
    return parsed as unknown as PermissionStore;
  }

  if (parsed.permissions && typeof parsed.permissions === "object") {
    return migrateLegacyNestedStore(
      parsed as { permissions?: Record<string, LegacyNestedEntry> },
    );
  }

  return migrateLegacyBooleanStore(
    parsed as Record<string, LegacyBooleanEntry>,
  );
}

function loadStore(): PermissionStore {
  try {
    if (!fs.existsSync(PERMISSIONS_FILE)) {
      return emptyStore();
    }
    const raw = JSON.parse(fs.readFileSync(PERMISSIONS_FILE, "utf-8"));
    const store = normalizeStore(raw);
    if ((raw as Record<string, unknown>).version !== STORE_VERSION) {
      saveStore(store);
    }
    return store;
  } catch {
    return emptyStore();
  }
}

function saveStore(store: PermissionStore): void {
  ensureDirExists(PERMISSIONS_FILE);
  fs.writeFileSync(PERMISSIONS_FILE, JSON.stringify(store, null, 2), "utf-8");
}

function getReadPermissionMatch(directory: string): PermissionMatch | null {
  const normalized = normalizeScope(directory);
  const sessionScope = findMostSpecificScope(
    normalized,
    readSessionPermissions.keys(),
  );
  if (sessionScope) {
    return {
      scopePath: sessionScope,
      level: readSessionPermissions.get(sessionScope)!,
    };
  }

  const store = loadStore();
  const persistedScope = findMostSpecificScope(
    normalized,
    Object.keys(store.projects),
  );
  if (!persistedScope) return null;
  const level = store.projects[persistedScope]?.readCodebase;
  if (!level) return null;
  return { scopePath: persistedScope, level };
}

function getWritePermissionMatch(directory: string): PermissionMatch | null {
  const normalized = normalizeScope(directory);
  const oneTimeScope = findMostSpecificScope(
    normalized,
    writeOneTimePermissions.keys(),
  );
  if (oneTimeScope) {
    return { scopePath: oneTimeScope, level: "one-time" };
  }

  const sessionScope = findMostSpecificScope(
    normalized,
    writeSessionPermissions.keys(),
  );
  if (sessionScope) {
    return {
      scopePath: sessionScope,
      level: writeSessionPermissions.get(sessionScope)!,
    };
  }

  const store = loadStore();
  const persistedScope = findMostSpecificScope(
    normalized,
    Object.keys(store.projects),
  );
  if (!persistedScope) return null;
  const level = store.projects[persistedScope]?.writeFiles;
  if (!level) return null;
  return { scopePath: persistedScope, level };
}

function upsertPersistedPermission(
  directory: string,
  updates: Partial<Pick<ProjectPermissionEntry, "readCodebase" | "writeFiles">>,
): void {
  const normalized = normalizeScope(directory);
  const store = loadStore();
  const existing = store.projects[normalized] || {};
  const next: ProjectPermissionEntry = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  if (
    !next.grantedAt &&
    (next.readCodebase === "always" || next.writeFiles === "always")
  ) {
    next.grantedAt = new Date().toISOString();
  }
  store.projects[normalized] = next;
  saveStore(store);
}

function clearPermissionScope(directory: string): void {
  const normalized = normalizeScope(directory);
  readSessionPermissions.delete(normalized);
  writeSessionPermissions.delete(normalized);
  writeOneTimePermissions.delete(normalized);

  const store = loadStore();
  delete store.projects[normalized];
  saveStore(store);
}

function clearAllPermissions(): void {
  readSessionPermissions.clear();
  writeSessionPermissions.clear();
  writeOneTimePermissions.clear();
  saveStore(emptyStore());
}

async function askChoice(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise<string>((resolve) => {
    rl.question(prompt, resolve);
  });
  rl.close();
  return answer.trim().toLowerCase();
}

export function hasCodebasePermission(directory: string): boolean | null {
  const match = getReadPermissionMatch(directory);
  if (!match) return null;
  return match.level !== "deny";
}

export function grantCodebasePermission(
  directory: string,
  level: ReadPermissionLevel = "always",
): void {
  const normalized = normalizeScope(directory);
  if (level === "session") {
    readSessionPermissions.set(normalized, "session");
    return;
  }
  upsertPersistedPermission(normalized, {
    readCodebase: level === "always" ? "always" : "deny",
  });
}

export function revokeCodebasePermission(directory?: string): void {
  if (!directory) {
    clearAllPermissions();
    return;
  }
  clearPermissionScope(directory);
}

export function getCodebasePermissionLevel(
  directory: string,
): ReadPermissionLevel | "unset" {
  const match = getReadPermissionMatch(directory);
  if (!match) return "unset";
  return match.level as ReadPermissionLevel;
}

export async function requestCodebasePermission(
  directory: string,
): Promise<boolean> {
  const normalized = normalizeScope(directory);
  const existing = getReadPermissionMatch(normalized);
  if (existing) {
    if (existing.level === "deny") return false;
    return true;
  }

  if (!process.stdin.isTTY) {
    return false;
  }

  const answer = await askChoice(
    `Consilium wants to read project files under ${normalized}.\nAllow read access? [n/session/always] `,
  );

  if (answer === "always" || answer === "a") {
    upsertPersistedPermission(normalized, { readCodebase: "always" });
    return true;
  }
  if (
    answer === "session" ||
    answer === "s" ||
    answer === "y" ||
    answer === "yes"
  ) {
    readSessionPermissions.set(normalized, "session");
    return true;
  }

  upsertPersistedPermission(normalized, { readCodebase: "deny" });
  return false;
}

export function getWritePermissionLevel(
  directory: string,
): WritePermissionLevel | "unset" {
  const match = getWritePermissionMatch(directory);
  if (!match) return "unset";
  return match.level as WritePermissionLevel;
}

export async function requestWritePermission(
  directory: string,
): Promise<WritePermissionLevel> {
  const normalized = normalizeScope(directory);
  const existing = getWritePermissionLevel(normalized);
  if (existing !== "unset") return existing;

  if (!process.stdin.isTTY) {
    return "deny";
  }

  const answer = await askChoice(
    `Consilium wants to edit files under ${normalized}.\nAllow write access? [n/once/session/always] `,
  );

  if (answer === "always" || answer === "a") {
    upsertPersistedPermission(normalized, { writeFiles: "always" });
    return "always";
  }
  if (answer === "session" || answer === "s") {
    writeSessionPermissions.set(normalized, "session");
    return "session";
  }
  if (
    answer === "once" ||
    answer === "one-time" ||
    answer === "o" ||
    answer === "y" ||
    answer === "yes"
  ) {
    writeOneTimePermissions.add(normalized);
    return "one-time";
  }

  upsertPersistedPermission(normalized, { writeFiles: "deny" });
  return "deny";
}

export function revokeWritePermission(directory?: string): void {
  if (!directory) {
    clearAllPermissions();
    return;
  }
  const normalized = normalizeScope(directory);
  writeOneTimePermissions.delete(normalized);
  writeSessionPermissions.delete(normalized);
  const store = loadStore();
  const entry = store.projects[normalized];
  if (entry) {
    entry.writeFiles = "deny";
    entry.updatedAt = new Date().toISOString();
    saveStore(store);
  }
}

export function consumeWritePermission(directory: string): boolean {
  const normalized = normalizeScope(directory);
  const match = getWritePermissionMatch(normalized);
  if (!match || match.level === "deny") {
    return false;
  }
  if (match.level === "one-time") {
    writeOneTimePermissions.delete(match.scopePath);
  }
  return true;
}

export interface PermissionSnapshot {
  scopePath: string;
  readCodebase: ReadPermissionLevel | "unset";
  writeFiles: WritePermissionLevel | "unset";
}

export function getPermissionSnapshot(directory: string): PermissionSnapshot {
  return {
    scopePath: normalizeScope(directory),
    readCodebase: getCodebasePermissionLevel(directory),
    writeFiles: getWritePermissionLevel(directory),
  };
}
