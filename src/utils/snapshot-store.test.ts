import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getSnapshotDir,
  ensureSnapshotDir,
  getSnapshotPath,
  writeSnapshot,
  readSnapshot,
  listSnapshotFiles,
  deleteSnapshotFile,
  formatAutoLabel,
  type SessionSnapshot,
} from "./snapshot-store";

let tmpDir: string;

function makeSnapshot(
  overrides: Partial<SessionSnapshot> = {},
): SessionSnapshot {
  return {
    id: "snap-1",
    sessionId: "ses_a",
    label: "label-a",
    createdAt: 1_700_000_000_000,
    debateCount: 0,
    payload: {
      id: "ses_a",
      name: "n",
      debates: [],
      contextFilePaths: [],
      contextImagePaths: [],
      models: [],
      mode: "council",
      decisions: {},
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    } as unknown as SessionSnapshot["payload"],
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "consilium-snap-"));
});

afterEach(() => {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("path helpers", () => {
  it("getSnapshotDir builds <baseDir>/<sessionId>/snapshots", () => {
    const dir = getSnapshotDir("ses_x", tmpDir);
    expect(dir).toBe(path.join(tmpDir, "ses_x", "snapshots"));
  });

  it("getSnapshotPath builds <baseDir>/<sessionId>/snapshots/<id>.json", () => {
    const p = getSnapshotPath("ses_x", "snap-1", tmpDir);
    expect(p).toBe(path.join(tmpDir, "ses_x", "snapshots", "snap-1.json"));
  });

  it("uses DEFAULT_SESSION_DIR when no baseDir provided", () => {
    const dir = getSnapshotDir("any");
    expect(dir).toContain(os.homedir());
    expect(dir).toContain(".consilium");
    expect(dir).toContain("sessions");
  });
});

describe("ensureSnapshotDir", () => {
  it("creates the snapshots directory if missing", () => {
    const dir = ensureSnapshotDir("ses_create", tmpDir);
    expect(fs.existsSync(dir)).toBe(true);
    expect(dir).toBe(path.join(tmpDir, "ses_create", "snapshots"));
  });

  it("is idempotent when called repeatedly", () => {
    ensureSnapshotDir("ses_idem", tmpDir);
    expect(() => ensureSnapshotDir("ses_idem", tmpDir)).not.toThrow();
  });
});

describe("writeSnapshot / readSnapshot", () => {
  it("writes a snapshot JSON file and reads it back", () => {
    const snap = makeSnapshot({ id: "snap-write", sessionId: "ses_w" });
    const filePath = writeSnapshot(snap, tmpDir);
    expect(fs.existsSync(filePath)).toBe(true);

    const loaded = readSnapshot("ses_w", "snap-write", tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe("snap-write");
    expect(loaded?.label).toBe("label-a");
  });

  it("readSnapshot returns null when file is missing", () => {
    expect(readSnapshot("ses_nope", "snap-x", tmpDir)).toBeNull();
  });

  it("readSnapshot returns null on corrupt JSON", () => {
    const dir = ensureSnapshotDir("ses_bad", tmpDir);
    fs.writeFileSync(path.join(dir, "snap-bad.json"), "{not-json", "utf-8");
    expect(readSnapshot("ses_bad", "snap-bad", tmpDir)).toBeNull();
  });
});

describe("listSnapshotFiles", () => {
  it("returns [] when snapshot directory is missing", () => {
    expect(listSnapshotFiles("ses_empty", tmpDir)).toEqual([]);
  });

  it("returns snapshots sorted by createdAt descending", () => {
    writeSnapshot(
      makeSnapshot({ id: "a", sessionId: "ses_s", createdAt: 100 }),
      tmpDir,
    );
    writeSnapshot(
      makeSnapshot({ id: "b", sessionId: "ses_s", createdAt: 300 }),
      tmpDir,
    );
    writeSnapshot(
      makeSnapshot({ id: "c", sessionId: "ses_s", createdAt: 200 }),
      tmpDir,
    );
    const list = listSnapshotFiles("ses_s", tmpDir);
    expect(list.map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  it("ignores corrupt snapshot files but returns valid ones", () => {
    writeSnapshot(
      makeSnapshot({ id: "ok", sessionId: "ses_mix", createdAt: 1 }),
      tmpDir,
    );
    const dir = ensureSnapshotDir("ses_mix", tmpDir);
    fs.writeFileSync(path.join(dir, "broken.json"), "{bad", "utf-8");
    const list = listSnapshotFiles("ses_mix", tmpDir);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe("ok");
  });

  it("only counts .json files (ignores other extensions)", () => {
    const dir = ensureSnapshotDir("ses_ext", tmpDir);
    fs.writeFileSync(path.join(dir, "not-snap.txt"), "ignored", "utf-8");
    writeSnapshot(
      makeSnapshot({ id: "real", sessionId: "ses_ext", createdAt: 1 }),
      tmpDir,
    );
    const list = listSnapshotFiles("ses_ext", tmpDir);
    expect(list.map((s) => s.id)).toEqual(["real"]);
  });
});

describe("deleteSnapshotFile", () => {
  it("removes the snapshot file and returns true", () => {
    writeSnapshot(
      makeSnapshot({ id: "to-delete", sessionId: "ses_d", createdAt: 1 }),
      tmpDir,
    );
    expect(deleteSnapshotFile("ses_d", "to-delete", tmpDir)).toBe(true);
    expect(readSnapshot("ses_d", "to-delete", tmpDir)).toBeNull();
  });

  it("returns false when the file does not exist", () => {
    expect(deleteSnapshotFile("ses_d", "ghost", tmpDir)).toBe(false);
  });
});

describe("formatAutoLabel", () => {
  it("renders a fixed-format auto-YYYYMMDD-HHMMSS label", () => {
    const fixed = new Date(2026, 4, 20, 3, 4, 5);
    expect(formatAutoLabel(fixed)).toBe("auto-20260520-030405");
  });

  it("pads single-digit month, day, hour, minute, second", () => {
    const fixed = new Date(2026, 0, 1, 1, 1, 1);
    expect(formatAutoLabel(fixed)).toBe("auto-20260101-010101");
  });

  it("matches the expected pattern with no explicit date", () => {
    expect(formatAutoLabel()).toMatch(/^auto-\d{8}-\d{6}$/);
  });
});
