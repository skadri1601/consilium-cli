import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import chalk from "chalk";
import {
  ChatSession,
  ChatSessionData,
  DebateRecord,
} from "../commands/chat-session";
import { ConsiliumClient } from "../api/client";
import { ContextManager } from "./context-manager";
import { generateId } from "./id";
import {
  type SessionSnapshot,
  deleteSnapshotFile,
  formatAutoLabel,
  listSnapshotFiles,
  readSnapshot,
  writeSnapshot,
} from "./snapshot-store";

const SESSION_DIR = path.join(os.homedir(), ".consilium", "sessions");

export const DEFAULT_SESSION_DIR = SESSION_DIR;

const MAX_SNAPSHOTS_PER_SESSION = 50;

export type SessionData = ChatSessionData & {
  forkedFrom?: string;
};

export type { SessionSnapshot } from "./snapshot-store";

export interface SessionMetadata {
  id: string;
  name: string;
  topic: string;
  debateCount: number;
  date: string;
  updatedAt: string;
  modelCount: number;
  preview: string;
}

export interface SearchResult {
  sessionId: string;
  sessionName: string;
  debateTopic: string;
  matchSnippet: string;
  matchType: "topic" | "synthesis";
}

function buildMatchSnippet(
  text: string,
  lowerQuery: string,
  query: string,
  contextBefore: number,
  contextAfter: number,
): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(lowerQuery);
  const start = Math.max(0, idx - contextBefore);
  const end = Math.min(text.length, idx + query.length + contextAfter);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return prefix + text.substring(start, end) + suffix;
}

function searchHitsForDebate(
  debate: DebateRecord,
  sessionId: string,
  sessionName: string,
  lowerQuery: string,
  query: string,
): SearchResult[] {
  const hits: SearchResult[] = [];
  if (debate.topic.toLowerCase().includes(lowerQuery)) {
    hits.push({
      sessionId,
      sessionName,
      debateTopic: debate.topic,
      matchSnippet: buildMatchSnippet(debate.topic, lowerQuery, query, 20, 20),
      matchType: "topic",
    });
  }
  const golden = debate.goldenPrompt;
  if (golden?.toLowerCase().includes(lowerQuery)) {
    hits.push({
      sessionId,
      sessionName,
      debateTopic: debate.topic,
      matchSnippet: buildMatchSnippet(golden, lowerQuery, query, 30, 30),
      matchType: "synthesis",
    });
  }
  return hits;
}

export class SessionManager {
  constructor(private readonly sessionDir: string = SESSION_DIR) {}

  private ensureSessionDir(): void {
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  private getSessionPath(sessionId: string): string {
    return path.join(this.sessionDir, `${sessionId}.json`);
  }

  private readSessionData(sessionId: string): ChatSessionData | null {
    const filePath = this.getSessionPath(sessionId);
    if (!fs.existsSync(filePath)) return null;
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content) as ChatSessionData;
    } catch {
      return null;
    }
  }

  saveSession(session: ChatSession): string {
    this.ensureSessionDir();
    const data = session.toJSON();
    const sessionId = data.id || generateId("session");
    data.id = sessionId;
    session.id = sessionId;

    const filePath = this.getSessionPath(sessionId);
    // Atomic write so two concurrent debate completions in the same
    // chat REPL can't corrupt the session JSON file (write-to-tmp
    // then rename - the loser's write fails cleanly instead of
    // interleaving JSON bytes with the winner's).
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmpPath, filePath);
    return sessionId;
  }

  listSessions(): SessionMetadata[] {
    if (!fs.existsSync(this.sessionDir)) {
      return [];
    }

    const files = fs
      .readdirSync(this.sessionDir)
      .filter((f) => f.endsWith(".json"));
    const result: SessionMetadata[] = [];

    for (const file of files) {
      try {
        const filePath = path.join(this.sessionDir, file);
        const content = fs.readFileSync(filePath, "utf-8");
        const data: ChatSessionData = JSON.parse(content);
        const debateCount = data.debates?.length ?? 0;
        const firstTopic = data.debates?.[0]?.topic ?? "Untitled";
        const topic =
          firstTopic.length > 40
            ? firstTopic.substring(0, 40) + "..."
            : firstTopic;
        const name = data.name || topic;
        const lastDebate =
          debateCount > 0 ? data.debates?.[debateCount - 1] : null;
        const lastSynthesis = lastDebate?.goldenPrompt || "";
        const preview =
          lastSynthesis.length > 80
            ? lastSynthesis.substring(0, 80) + "..."
            : lastSynthesis || "(no synthesis)";

        result.push({
          id: data.id || path.basename(file, ".json"),
          name,
          topic,
          debateCount,
          date: data.createdAt || "",
          updatedAt: data.updatedAt || data.createdAt || "",
          modelCount: data.models?.length ?? 0,
          preview,
        });
      } catch {
        // skip invalid
      }
    }

    result.sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));
    return result;
  }

  loadSession(sessionId: string): ChatSession {
    this.ensureSessionDir();
    const filePath = this.getSessionPath(sessionId);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const data: ChatSessionData = JSON.parse(content);

    const client = new ConsiliumClient();
    const contextManager = new ContextManager();
    const session = ChatSession.fromJSON(data, client, contextManager);

    if (data.contextFilePaths?.length) {
      for (const ctxFilePath of data.contextFilePaths) {
        try {
          contextManager.addFile(ctxFilePath);
        } catch (error: any) {
          console.warn(
            chalk.yellow(`Could not reload file: ${ctxFilePath}`),
            error?.message || "",
          );
        }
      }
    }

    return session;
  }

  renameSession(sessionId: string, newName: string): boolean {
    const data = this.readSessionData(sessionId);
    if (!data) return false;
    data.name = newName;
    data.updatedAt = new Date().toISOString();
    const filePath = this.getSessionPath(sessionId);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    return true;
  }

  deleteSession(sessionId: string): boolean {
    const filePath = this.getSessionPath(sessionId);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }

  searchSessions(query: string): SearchResult[] {
    if (!fs.existsSync(this.sessionDir)) return [];

    const files = fs
      .readdirSync(this.sessionDir)
      .filter((f) => f.endsWith(".json"));
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    for (const file of files) {
      try {
        const filePath = path.join(this.sessionDir, file);
        const content = fs.readFileSync(filePath, "utf-8");
        const data: ChatSessionData = JSON.parse(content);
        const sessionId = data.id || path.basename(file, ".json");
        const sessionName = data.name || data.debates?.[0]?.topic || "Untitled";

        for (const debate of data.debates || []) {
          results.push(
            ...searchHitsForDebate(
              debate,
              sessionId,
              sessionName,
              lowerQuery,
              query,
            ),
          );
        }
      } catch {
        // skip invalid
      }
    }

    return results;
  }

  formatRelativeTime(isoDate: string): string {
    if (!isoDate) return "";
    const now = Date.now();
    const then = new Date(isoDate).getTime();
    const diffMs = now - then;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay === 1) return "yesterday";
    if (diffDay < 30) return `${diffDay}d ago`;
    return new Date(isoDate).toLocaleDateString();
  }

  snapshotSession(sessionId: string, label?: string): SessionSnapshot {
    const data = this.readSessionData(sessionId);
    if (!data) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const payload = structuredClone(data) as ChatSessionData;
    const snapshot: SessionSnapshot = {
      id: crypto.randomUUID(),
      sessionId,
      label: label ?? formatAutoLabel(),
      createdAt: Date.now(),
      debateCount: payload.debates?.length ?? 0,
      payload,
    };

    writeSnapshot(snapshot, this.sessionDir);
    this.purgeOldSnapshots(sessionId);
    return snapshot;
  }

  listSnapshots(sessionId: string): SessionSnapshot[] {
    return listSnapshotFiles(sessionId, this.sessionDir);
  }

  restoreSnapshot(sessionId: string, snapshotId: string): void {
    const snap = readSnapshot(sessionId, snapshotId, this.sessionDir);
    if (!snap) {
      throw new Error(
        `Snapshot not found: ${snapshotId} (session: ${sessionId})`,
      );
    }

    const current = this.readSessionData(sessionId);
    if (current) {
      const autoSnap: SessionSnapshot = {
        id: crypto.randomUUID(),
        sessionId,
        label: `auto-pre-restore-${formatAutoLabel().replace(/^auto-/, "")}`,
        createdAt: Date.now(),
        debateCount: current.debates?.length ?? 0,
        payload: structuredClone(current) as ChatSessionData,
      };
      writeSnapshot(autoSnap, this.sessionDir);
    }

    const restored: SessionData = {
      ...(structuredClone(snap.payload) as ChatSessionData),
      id: sessionId,
      updatedAt: new Date().toISOString(),
    } as SessionData;

    this.ensureSessionDir();
    const filePath = this.getSessionPath(sessionId);
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(restored, null, 2), "utf-8");
    fs.renameSync(tmpPath, filePath);
  }

  deleteSnapshot(sessionId: string, snapshotId: string): void {
    const removed = deleteSnapshotFile(sessionId, snapshotId, this.sessionDir);
    if (!removed) {
      throw new Error(
        `Snapshot not found: ${snapshotId} (session: ${sessionId})`,
      );
    }
  }

  private purgeOldSnapshots(sessionId: string): void {
    const snaps = this.listSnapshots(sessionId);
    if (snaps.length <= MAX_SNAPSHOTS_PER_SESSION) return;
    const toRemove = snaps.slice(MAX_SNAPSHOTS_PER_SESSION);
    for (const snap of toRemove) {
      deleteSnapshotFile(sessionId, snap.id, this.sessionDir);
    }
  }

  forkSession(sourceSessionId: string, newName?: string): string {
    const data = this.readSessionData(sourceSessionId);
    if (!data) {
      throw new Error(`Session not found: ${sourceSessionId}`);
    }

    const cloned = structuredClone(data) as SessionData;
    const newId = generateId("session");
    const now = new Date().toISOString();
    const sourceName = data.name || data.debates?.[0]?.topic || "Untitled";
    cloned.id = newId;
    cloned.name = newName ?? `${sourceName} (fork)`;
    cloned.forkedFrom = sourceSessionId;
    cloned.createdAt = now;
    cloned.updatedAt = now;

    this.ensureSessionDir();
    const filePath = this.getSessionPath(newId);
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(cloned, null, 2), "utf-8");
    fs.renameSync(tmpPath, filePath);

    return newId;
  }
}

export function snapshotSession(
  sessionId: string,
  label?: string,
): SessionSnapshot {
  return new SessionManager().snapshotSession(sessionId, label);
}

export function listSnapshots(sessionId: string): SessionSnapshot[] {
  return new SessionManager().listSnapshots(sessionId);
}

export function restoreSnapshot(sessionId: string, snapshotId: string): void {
  new SessionManager().restoreSnapshot(sessionId, snapshotId);
}

export function deleteSnapshot(sessionId: string, snapshotId: string): void {
  new SessionManager().deleteSnapshot(sessionId, snapshotId);
}

export function forkSession(sourceSessionId: string, newName?: string): string {
  return new SessionManager().forkSession(sourceSessionId, newName);
}
