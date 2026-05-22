import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  appendMemoryNote,
  extractInsightFromSynthesis,
  getMemoryPath,
  loadMemory,
  maybeAppendFromSynthesis,
  renderMemoryForPrompt,
} from "./auto-memory";

let fakeHome: string;

beforeEach(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "consilium-am-home-"));
  vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (fs.existsSync(fakeHome)) {
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});

describe("auto-memory", () => {
  it("returns null when no memory file exists", () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "p-"));
    try {
      expect(loadMemory(project)).toBeNull();
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("getMemoryPath uses a stable hash of the absolute path", () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "p-"));
    try {
      const p1 = getMemoryPath(project);
      const p2 = getMemoryPath(project);
      expect(p1).toBe(p2);
      expect(p1).toContain(path.join(fakeHome, ".consilium", "projects"));
      expect(p1.endsWith("MEMORY.md")).toBe(true);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("auto-creates parent directories when appending", () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "p-"));
    try {
      const memPath = getMemoryPath(project);
      expect(fs.existsSync(path.dirname(memPath))).toBe(false);
      appendMemoryNote(
        {
          topic: "Database choice",
          insight: "decision: use Neon",
          source: "ses_1",
        },
        project,
      );
      expect(fs.existsSync(memPath)).toBe(true);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("round-trips a single note through save and load", () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "p-"));
    try {
      appendMemoryNote(
        {
          topic: "Style",
          insight: "preference: no comments in code",
          source: "ses_a",
        },
        project,
      );
      const loaded = loadMemory(project);
      expect(loaded).not.toBeNull();
      expect(loaded!.notes).toHaveLength(1);
      expect(loaded!.notes[0]?.topic).toBe("Style");
      expect(loaded!.notes[0]?.insight).toBe("preference: no comments in code");
      expect(loaded!.notes[0]?.source).toBe("ses_a");
      expect(loaded!.projectPath).toBe(path.resolve(project));
      expect(loaded!.projectHash).toMatch(/^[0-9a-f]{12}$/);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("appends multiple notes in chronological order", () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "p-"));
    try {
      appendMemoryNote({ topic: "t1", insight: "first" }, project);
      appendMemoryNote({ topic: "t2", insight: "second" }, project);
      appendMemoryNote({ topic: "t3", insight: "third" }, project);
      const loaded = loadMemory(project);
      expect(loaded!.notes.map((n) => n.topic)).toEqual(["t1", "t2", "t3"]);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("project hash differs across projects", () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), "pa-"));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), "pb-"));
    try {
      appendMemoryNote({ topic: "x", insight: "y" }, a);
      appendMemoryNote({ topic: "x", insight: "z" }, b);
      const ma = loadMemory(a)!;
      const mb = loadMemory(b)!;
      expect(ma.projectHash).not.toBe(mb.projectHash);
    } finally {
      fs.rmSync(a, { recursive: true, force: true });
      fs.rmSync(b, { recursive: true, force: true });
    }
  });

  it("renderMemoryForPrompt formats notes and respects maxLines", () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "p-"));
    try {
      for (let i = 0; i < 6; i++) {
        appendMemoryNote(
          { topic: `topic ${i}`, insight: `note ${i}` },
          project,
        );
      }
      const mem = loadMemory(project)!;
      const rendered = renderMemoryForPrompt(mem, 3);
      expect(rendered).toContain("Project memory:");
      expect(rendered).toContain("topic 5");
      expect(rendered).toContain("topic 4");
      expect(rendered).toContain("topic 3");
      expect(rendered).not.toContain("topic 0");
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("renderMemoryForPrompt handles empty notes", () => {
    const mem = {
      projectHash: "abc",
      projectPath: "/x",
      createdAt: 0,
      updatedAt: 0,
      notes: [],
      preferences: {},
    };
    const out = renderMemoryForPrompt(mem);
    expect(out).toContain("/x");
    expect(out).toContain("No notes yet");
  });

  describe("extractInsightFromSynthesis", () => {
    it("extracts user preference statements", () => {
      const result = extractInsightFromSynthesis(
        "After review, the user prefers Neon over Supabase for serverless scaling.",
      );
      expect(result?.kind).toBe("preference");
      expect(result?.insight).toContain("Neon over Supabase");
    });

    it("extracts constraint statements", () => {
      const result = extractInsightFromSynthesis(
        "constraint: All workloads must run on Node 20 or newer.",
      );
      expect(result?.kind).toBe("constraint");
      expect(result?.insight).toContain("Node 20");
    });

    it("extracts decision statements", () => {
      const result = extractInsightFromSynthesis(
        "Decision: adopt BullMQ for async debate processing.",
      );
      expect(result?.kind).toBe("decision");
      expect(result?.insight).toContain("BullMQ");
    });

    it("extracts remember statements", () => {
      const result = extractInsightFromSynthesis(
        "remember: never push to main from CI.",
      );
      expect(result?.kind).toBe("remember");
      expect(result?.insight).toContain("never push to main");
    });

    it("returns null when no marker keywords are present", () => {
      expect(
        extractInsightFromSynthesis(
          "We compared options and concluded that both have merit.",
        ),
      ).toBeNull();
    });

    it("returns null for empty input", () => {
      expect(extractInsightFromSynthesis("")).toBeNull();
    });
  });

  it("maybeAppendFromSynthesis writes a note when a marker matches", () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "p-"));
    try {
      const note = maybeAppendFromSynthesis({
        topic: "DB choice",
        synthesis: "decision: use Neon for the primary DB.",
        source: "dbt_1",
        projectPath: project,
      });
      expect(note).not.toBeNull();
      expect(note!.insight).toContain("decision");
      const loaded = loadMemory(project)!;
      expect(loaded.notes).toHaveLength(1);
      expect(loaded.notes[0]?.source).toBe("dbt_1");
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("maybeAppendFromSynthesis skips synthesis without markers", () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "p-"));
    try {
      const note = maybeAppendFromSynthesis({
        topic: "general",
        synthesis: "The council weighed several factors but did not commit.",
        projectPath: project,
      });
      expect(note).toBeNull();
      expect(loadMemory(project)).toBeNull();
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("preserves metadata across multiple appends", () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "p-"));
    try {
      appendMemoryNote({ topic: "a", insight: "alpha" }, project);
      const first = loadMemory(project)!;
      const firstCreatedAt = first.createdAt;
      appendMemoryNote({ topic: "b", insight: "beta" }, project);
      const second = loadMemory(project)!;
      expect(second.createdAt).toBe(firstCreatedAt);
      expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
      expect(second.notes).toHaveLength(2);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});
