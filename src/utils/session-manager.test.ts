import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({
  ConsiliumClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./context-manager", () => ({
  ContextManager: vi.fn().mockImplementation(() => ({
    addFile: vi.fn(),
    clear: vi.fn(),
    buildContext: vi.fn().mockReturnValue(""),
    getFiles: vi.fn().mockReturnValue([]),
    getFilesWithContent: vi.fn().mockReturnValue([]),
    getImages: vi.fn().mockReturnValue([]),
  })),
}));

import { SessionManager } from "./session-manager";
import { type SessionSnapshot } from "./snapshot-store";

let tmpDir: string;
let sm: SessionManager;

function makeSessionData(overrides: Record<string, unknown> = {}) {
  return {
    id: "ses_test",
    name: "Original Session",
    debates: [
      { topic: "First topic", timestamp: "2026-01-01T00:00:00.000Z" },
      {
        topic: "Second topic",
        goldenPrompt: "Synthesis text",
        timestamp: "2026-01-02T00:00:00.000Z",
      },
    ],
    contextFilePaths: [],
    contextImagePaths: [],
    models: ["gpt-5.4"],
    mode: "council",
    decisions: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function writeSessionFile(id: string, data: object) {
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, `${id}.json`),
    JSON.stringify(data),
    "utf-8",
  );
}

function readSessionFile(id: string): any {
  const content = fs.readFileSync(path.join(tmpDir, `${id}.json`), "utf-8");
  return JSON.parse(content);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "consilium-sm-snap-"));
  sm = new SessionManager(tmpDir);
});

afterEach(() => {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("snapshotSession", () => {
  it("creates a snapshot file and listing returns one entry", () => {
    writeSessionFile("ses_snap1", makeSessionData({ id: "ses_snap1" }));

    const snap = sm.snapshotSession("ses_snap1", "before-edit");
    expect(snap.id).toBeTruthy();
    expect(snap.sessionId).toBe("ses_snap1");
    expect(snap.label).toBe("before-edit");
    expect(snap.debateCount).toBe(2);
    expect(snap.payload.name).toBe("Original Session");
    expect(snap.payload.debates).toHaveLength(2);

    const list = sm.listSnapshots("ses_snap1");
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(snap.id);
    expect(list[0]?.label).toBe("before-edit");

    const snapPath = path.join(
      tmpDir,
      "ses_snap1",
      "snapshots",
      `${snap.id}.json`,
    );
    expect(fs.existsSync(snapPath)).toBe(true);
  });

  it("generates an auto label when none provided", () => {
    writeSessionFile("ses_auto", makeSessionData({ id: "ses_auto" }));
    const snap = sm.snapshotSession("ses_auto");
    expect(snap.label).toMatch(/^auto-\d{8}-\d{6}$/);
  });

  it("throws when source session does not exist", () => {
    expect(() => sm.snapshotSession("missing")).toThrow(/Session not found/);
  });

  it("uses crypto.randomUUID for snapshot id", () => {
    writeSessionFile("ses_id", makeSessionData({ id: "ses_id" }));
    const snap = sm.snapshotSession("ses_id");
    expect(snap.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});

describe("restoreSnapshot", () => {
  it("restores session state from snapshot after mutation", () => {
    writeSessionFile("ses_restore", makeSessionData({ id: "ses_restore" }));
    const snap = sm.snapshotSession("ses_restore", "checkpoint");

    const mutated = makeSessionData({
      id: "ses_restore",
      name: "Mutated",
      debates: [{ topic: "Different", timestamp: "2026-03-01T00:00:00.000Z" }],
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
    writeSessionFile("ses_restore", mutated);

    sm.restoreSnapshot("ses_restore", snap.id);

    const restored = readSessionFile("ses_restore");
    expect(restored.name).toBe("Original Session");
    expect(restored.debates).toHaveLength(2);
    expect(restored.debates[0].topic).toBe("First topic");
    expect(restored.id).toBe("ses_restore");
    expect(new Date(restored.updatedAt).getTime()).toBeGreaterThan(
      new Date(mutated.updatedAt).getTime(),
    );
  });

  it("creates an auto-pre-restore snapshot before restoring", () => {
    writeSessionFile("ses_pre", makeSessionData({ id: "ses_pre" }));
    const snap = sm.snapshotSession("ses_pre", "user-checkpoint");

    writeSessionFile(
      "ses_pre",
      makeSessionData({
        id: "ses_pre",
        name: "Current State",
        debates: [{ topic: "Current", timestamp: "2026-04-01T00:00:00.000Z" }],
      }),
    );

    sm.restoreSnapshot("ses_pre", snap.id);

    const list = sm.listSnapshots("ses_pre");
    expect(list.length).toBeGreaterThanOrEqual(2);
    const autoSnap = list.find((s) => s.label.startsWith("auto-pre-restore-"));
    expect(autoSnap).toBeDefined();
    expect(autoSnap?.payload.name).toBe("Current State");
    expect(autoSnap?.payload.debates[0]?.topic).toBe("Current");
  });

  it("throws a clear error when snapshot id is unknown", () => {
    writeSessionFile("ses_x", makeSessionData({ id: "ses_x" }));
    expect(() => sm.restoreSnapshot("ses_x", "no-such-snap")).toThrow(
      /Snapshot not found.*no-such-snap/,
    );
  });

  it("skips pre-restore snapshot when source session file is missing", () => {
    writeSessionFile("ses_seed", makeSessionData({ id: "ses_seed" }));
    const snap = sm.snapshotSession("ses_seed", "seed");
    fs.unlinkSync(path.join(tmpDir, "ses_seed.json"));

    sm.restoreSnapshot("ses_seed", snap.id);

    const restored = readSessionFile("ses_seed");
    expect(restored.name).toBe("Original Session");
    const list = sm.listSnapshots("ses_seed");
    expect(list.filter((s) => s.label.startsWith("auto-pre-restore-"))).toEqual(
      [],
    );
  });
});

describe("forkSession", () => {
  it("creates a new session with new id and copies all debates", () => {
    writeSessionFile("ses_src", makeSessionData({ id: "ses_src" }));
    const newId = sm.forkSession("ses_src", "Branch A");

    expect(newId).not.toBe("ses_src");
    expect(fs.existsSync(path.join(tmpDir, `${newId}.json`))).toBe(true);

    const forked = readSessionFile(newId);
    expect(forked.id).toBe(newId);
    expect(forked.name).toBe("Branch A");
    expect(forked.debates).toHaveLength(2);
    expect(forked.debates[0].topic).toBe("First topic");
    expect(forked.forkedFrom).toBe("ses_src");

    const source = readSessionFile("ses_src");
    expect(source.id).toBe("ses_src");
    expect(source.name).toBe("Original Session");
  });

  it("defaults the new name to '<source.name> (fork)' when no name given", () => {
    writeSessionFile("ses_default", makeSessionData({ id: "ses_default" }));
    const newId = sm.forkSession("ses_default");
    const forked = readSessionFile(newId);
    expect(forked.name).toBe("Original Session (fork)");
  });

  it("does not copy snapshots to the new fork", () => {
    writeSessionFile(
      "ses_with_snaps",
      makeSessionData({ id: "ses_with_snaps" }),
    );
    sm.snapshotSession("ses_with_snaps", "snap-a");
    sm.snapshotSession("ses_with_snaps", "snap-b");
    expect(sm.listSnapshots("ses_with_snaps")).toHaveLength(2);

    const newId = sm.forkSession("ses_with_snaps");
    expect(sm.listSnapshots(newId)).toEqual([]);
  });

  it("throws when source session does not exist", () => {
    expect(() => sm.forkSession("missing-src")).toThrow(/Session not found/);
  });
});

describe("deleteSnapshot", () => {
  it("removes snapshot from disk and from list", () => {
    writeSessionFile("ses_del", makeSessionData({ id: "ses_del" }));
    const snap = sm.snapshotSession("ses_del", "to-delete");
    expect(sm.listSnapshots("ses_del")).toHaveLength(1);

    sm.deleteSnapshot("ses_del", snap.id);

    const snapPath = path.join(
      tmpDir,
      "ses_del",
      "snapshots",
      `${snap.id}.json`,
    );
    expect(fs.existsSync(snapPath)).toBe(false);
    expect(sm.listSnapshots("ses_del")).toEqual([]);
  });

  it("throws when snapshot id does not exist", () => {
    writeSessionFile("ses_none", makeSessionData({ id: "ses_none" }));
    expect(() => sm.deleteSnapshot("ses_none", "no-such-id")).toThrow(
      /Snapshot not found/,
    );
  });
});

describe("listSnapshots", () => {
  it("returns empty array when no snapshot dir exists", () => {
    expect(sm.listSnapshots("ghost")).toEqual([]);
  });

  it("returns snapshots sorted by createdAt descending", async () => {
    writeSessionFile("ses_order", makeSessionData({ id: "ses_order" }));
    const first = sm.snapshotSession("ses_order", "first");
    await new Promise((r) => setTimeout(r, 5));
    const second = sm.snapshotSession("ses_order", "second");

    const list = sm.listSnapshots("ses_order");
    expect(list).toHaveLength(2);
    expect(list[0]?.id).toBe(second.id);
    expect(list[1]?.id).toBe(first.id);
  });
});

describe("free function exports", () => {
  it("re-exports SessionSnapshot type and free functions remain usable as a unit", () => {
    writeSessionFile("ses_free", makeSessionData({ id: "ses_free" }));
    const snap: SessionSnapshot = sm.snapshotSession("ses_free", "x");
    expect(snap.payload.id).toBe("ses_free");
  });
});
