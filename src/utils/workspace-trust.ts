import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type TrustLevel = "always" | "session";

export interface TrustEntry {
  path: string;
  trustedAt: number;
  level: TrustLevel;
}

interface TrustStore {
  version: number;
  entries: TrustEntry[];
}

const STORE_VERSION = 1;
const DEFAULT_TRUST_DIR = path.join(os.homedir(), ".consilium");
const DEFAULT_TRUST_FILE = path.join(DEFAULT_TRUST_DIR, "workspace-trust.json");

const sessionTrust = new Map<string, TrustEntry>();

let trustFileOverride: string | null = null;

export function __setWorkspaceTrustFileForTests(p: string | null): void {
  trustFileOverride = p;
}

export function __clearSessionTrustForTests(): void {
  sessionTrust.clear();
}

function trustFile(): string {
  return trustFileOverride ?? DEFAULT_TRUST_FILE;
}

function normalize(p: string): string {
  return path.resolve(p);
}

function isPathInside(candidate: string, scope: string): boolean {
  return candidate === scope || candidate.startsWith(scope + path.sep);
}

function emptyStore(): TrustStore {
  return { version: STORE_VERSION, entries: [] };
}

function loadStore(): TrustStore {
  const file = trustFile();
  try {
    if (!fs.existsSync(file)) return emptyStore();
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw) as Partial<TrustStore>;
    if (!Array.isArray(parsed.entries)) return emptyStore();
    const entries: TrustEntry[] = [];
    for (const e of parsed.entries) {
      if (
        e &&
        typeof e === "object" &&
        typeof (e as TrustEntry).path === "string" &&
        ((e as TrustEntry).level === "always" ||
          (e as TrustEntry).level === "session")
      ) {
        entries.push({
          path: normalize((e as TrustEntry).path),
          trustedAt:
            typeof (e as TrustEntry).trustedAt === "number"
              ? (e as TrustEntry).trustedAt
              : Date.now(),
          level: (e as TrustEntry).level,
        });
      }
    }
    return { version: STORE_VERSION, entries };
  } catch {
    return emptyStore();
  }
}

function saveStore(store: TrustStore): void {
  const file = trustFile();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(file, JSON.stringify(store, null, 2), {
    mode: 0o600,
  });
}

function findScope(
  target: string,
  entries: Iterable<TrustEntry>,
): TrustEntry | null {
  let best: TrustEntry | null = null;
  for (const e of entries) {
    if (!isPathInside(target, e.path)) continue;
    if (!best || e.path.length > best.path.length) best = e;
  }
  return best;
}

function bestMatch(p: string): TrustEntry | null {
  const norm = normalize(p);
  const store = loadStore();
  const sessionMatch = findScope(norm, sessionTrust.values());
  const persistedMatch = findScope(norm, store.entries);
  if (sessionMatch && persistedMatch) {
    return persistedMatch.path.length >= sessionMatch.path.length
      ? persistedMatch
      : sessionMatch;
  }
  return sessionMatch ?? persistedMatch;
}

export function isPathTrusted(p: string): boolean {
  const match = bestMatch(p);
  return match !== null;
}

export function getTrustLevel(p: string): TrustLevel | null {
  const match = bestMatch(p);
  return match ? match.level : null;
}

export function trustPath(p: string, level: TrustLevel): void {
  const norm = normalize(p);
  const entry: TrustEntry = {
    path: norm,
    trustedAt: Date.now(),
    level,
  };
  if (level === "session") {
    sessionTrust.set(norm, entry);
    return;
  }
  const store = loadStore();
  const others = store.entries.filter((e) => e.path !== norm);
  others.push(entry);
  saveStore({ version: STORE_VERSION, entries: others });
}

export function untrustPath(p: string): void {
  const norm = normalize(p);
  sessionTrust.delete(norm);
  const store = loadStore();
  const next = store.entries.filter((e) => e.path !== norm);
  if (next.length !== store.entries.length) {
    saveStore({ version: STORE_VERSION, entries: next });
  }
}

export function listTrustedPaths(): TrustEntry[] {
  const store = loadStore();
  const result: TrustEntry[] = [...store.entries];
  for (const entry of sessionTrust.values()) {
    if (!result.find((e) => e.path === entry.path)) {
      result.push(entry);
    }
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
