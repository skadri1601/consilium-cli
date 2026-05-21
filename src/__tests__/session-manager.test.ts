import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const TMP_HOME = vi.hoisted(() => {
  const base =
    process.env.TEMP || process.env.TMPDIR || process.env.TMP || "/tmp";
  return base.replace(/\\/g, "/") + `/consilium-sm-test-${process.pid}`;
});

vi.mock("node:os", () => ({
  default: {
    homedir: () => TMP_HOME,
    tmpdir: () =>
      process.env.TEMP || process.env.TMPDIR || process.env.TMP || "/tmp",
  },
  homedir: () => TMP_HOME,
  tmpdir: () =>
    process.env.TEMP || process.env.TMPDIR || process.env.TMP || "/tmp",
}));

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

const SESSION_DIR = TMP_HOME + "/.consilium/sessions";

function clearSessionDir() {
  const base = TMP_HOME + "/.consilium";
  if (fs.existsSync(base)) {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

function writeSessionFile(id: string, data: object) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(SESSION_DIR, `${id}.json`),
    JSON.stringify(data),
    "utf-8",
  );
}

function makeSessionData(overrides: Record<string, unknown> = {}) {
  return {
    id: "ses_test1",
    name: "Test Session",
    debates: [],
    contextFilePaths: [],
    contextImagePaths: [],
    models: ["gpt-5.4"],
    mode: "council",
    decisions: {},
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

import { SessionManager } from "../utils/session-manager";

let sm: SessionManager;

beforeEach(() => {
  clearSessionDir();
  vi.unstubAllEnvs();
  sm = new SessionManager(SESSION_DIR);
});

afterEach(() => {
  clearSessionDir();
  vi.unstubAllEnvs();
});

describe("listSessions", () => {
  it("returns empty array when no sessions exist", () => {
    expect(sm.listSessions()).toEqual([]);
  });

  it("returns sessions sorted by updatedAt descending", () => {
    writeSessionFile(
      "ses_old",
      makeSessionData({
        id: "ses_old",
        name: "Old",
        updatedAt: "2025-01-01T00:00:00.000Z",
        debates: [
          { topic: "Old topic", timestamp: "2025-01-01T00:00:00.000Z" },
        ],
      }),
    );
    writeSessionFile(
      "ses_new",
      makeSessionData({
        id: "ses_new",
        name: "New",
        updatedAt: "2025-06-01T00:00:00.000Z",
        debates: [
          { topic: "New topic", timestamp: "2025-06-01T00:00:00.000Z" },
        ],
      }),
    );
    const sessions = sm.listSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions[0].id).toBe("ses_new");
    expect(sessions[1].id).toBe("ses_old");
  });

  it("skips malformed JSON files", () => {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    fs.writeFileSync(path.join(SESSION_DIR, "bad.json"), "not json", "utf-8");
    writeSessionFile("ses_good", makeSessionData({ id: "ses_good" }));
    const sessions = sm.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("ses_good");
  });
});

describe("loadSession", () => {
  it("throws for nonexistent session", () => {
    expect(() => sm.loadSession("nonexistent")).toThrow(/Session not found/);
  });

  it("returns ChatSession for existing session", () => {
    writeSessionFile(
      "ses_load",
      makeSessionData({
        id: "ses_load",
        name: "Load Test",
        models: ["gpt-5.4"],
        mode: "council",
      }),
    );
    const session = sm.loadSession("ses_load");
    expect(session.id).toBe("ses_load");
    expect(session.name).toBe("Load Test");
    expect(session.models).toEqual(["gpt-5.4"]);
  });
});

function makeFakeSession(id: string, name: string, debates: any[] = []) {
  const obj: any = {
    id,
    name,
    debates,
    toJSON() {
      return {
        id: obj.id,
        name: obj.name,
        debates: obj.debates,
        contextFilePaths: [],
        contextImagePaths: [],
        models: ["gpt-5.4"],
        mode: "council",
        decisions: {},
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      };
    },
  };
  return obj;
}

describe("saveSession", () => {
  it("creates session file", () => {
    const session = makeFakeSession("ses_save1", "Saved Session", [
      {
        topic: "Test topic",
        goldenPrompt: "result",
        timestamp: new Date().toISOString(),
      },
    ]);

    const id = sm.saveSession(session);
    expect(id).toBe("ses_save1");
    const filePath = path.join(SESSION_DIR, `${id}.json`);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("updates existing session file", () => {
    const session = makeFakeSession("ses_update", "V1");
    sm.saveSession(session);

    session.name = "V2";
    sm.saveSession(session);

    const content = fs.readFileSync(
      path.join(SESSION_DIR, "ses_update.json"),
      "utf-8",
    );
    const data = JSON.parse(content);
    expect(data.name).toBe("V2");
  });
});

describe("deleteSession", () => {
  it("removes session file", () => {
    writeSessionFile("ses_del", makeSessionData({ id: "ses_del" }));
    const result = sm.deleteSession("ses_del");
    expect(result).toBe(true);
    expect(fs.existsSync(path.join(SESSION_DIR, "ses_del.json"))).toBe(false);
  });

  it("returns false for nonexistent session", () => {
    expect(sm.deleteSession("nonexistent")).toBe(false);
  });
});

describe("renameSession", () => {
  it("updates session name in metadata", () => {
    writeSessionFile(
      "ses_rename",
      makeSessionData({ id: "ses_rename", name: "Old Name" }),
    );
    const result = sm.renameSession("ses_rename", "New Name");
    expect(result).toBe(true);
    const content = fs.readFileSync(
      path.join(SESSION_DIR, "ses_rename.json"),
      "utf-8",
    );
    const data = JSON.parse(content);
    expect(data.name).toBe("New Name");
  });

  it("returns false for nonexistent session", () => {
    expect(sm.renameSession("nonexistent", "Name")).toBe(false);
  });

  it("updates the updatedAt timestamp", () => {
    writeSessionFile(
      "ses_rename2",
      makeSessionData({
        id: "ses_rename2",
        updatedAt: "2020-01-01T00:00:00.000Z",
      }),
    );
    sm.renameSession("ses_rename2", "Renamed");
    const content = fs.readFileSync(
      path.join(SESSION_DIR, "ses_rename2.json"),
      "utf-8",
    );
    const data = JSON.parse(content);
    expect(data.updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
  });
});

describe("searchSessions", () => {
  it("returns empty when no sessions", () => {
    expect(sm.searchSessions("anything")).toEqual([]);
  });

  it("finds sessions by topic keyword", () => {
    writeSessionFile(
      "ses_search",
      makeSessionData({
        id: "ses_search",
        name: "Search Test",
        debates: [
          {
            topic: "How to optimize database queries",
            timestamp: "2025-01-01T00:00:00.000Z",
          },
          {
            topic: "React component patterns",
            timestamp: "2025-01-02T00:00:00.000Z",
          },
        ],
      }),
    );
    const results = sm.searchSessions("database");
    expect(results).toHaveLength(1);
    expect(results[0].matchType).toBe("topic");
    expect(results[0].debateTopic).toContain("database");
  });

  it("finds sessions by synthesis content", () => {
    writeSessionFile(
      "ses_synth",
      makeSessionData({
        id: "ses_synth",
        name: "Synth Test",
        debates: [
          {
            topic: "API design",
            goldenPrompt: "Use REST endpoints with proper pagination",
            timestamp: "2025-01-01T00:00:00.000Z",
          },
        ],
      }),
    );
    const results = sm.searchSessions("pagination");
    expect(results).toHaveLength(1);
    expect(results[0].matchType).toBe("synthesis");
  });

  it("search is case-insensitive", () => {
    writeSessionFile(
      "ses_case",
      makeSessionData({
        id: "ses_case",
        name: "Case Test",
        debates: [
          {
            topic: "TypeScript Generics",
            timestamp: "2025-01-01T00:00:00.000Z",
          },
        ],
      }),
    );
    const results = sm.searchSessions("typescript");
    expect(results).toHaveLength(1);
  });

  it("returns empty for non-matching query", () => {
    writeSessionFile(
      "ses_nomatch",
      makeSessionData({
        id: "ses_nomatch",
        debates: [
          { topic: "Python decorators", timestamp: "2025-01-01T00:00:00.000Z" },
        ],
      }),
    );
    expect(sm.searchSessions("kubernetes")).toHaveLength(0);
  });
});
