import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendProjectMemory,
  formatMemoryForPrompt,
  loadProjectMemory,
  memoryFileExists,
  memoryFilePath,
} from "./project-memory";

function mkdtemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "consilium-memory-test-"));
}

describe("project-memory", () => {
  const created: string[] = [];

  afterEach(() => {
    for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
    created.length = 0;
  });

  it("returns no entries when memory file is absent", () => {
    const root = mkdtemp();
    created.push(root);
    expect(memoryFileExists(root)).toBe(false);
    expect(loadProjectMemory(root)).toEqual([]);
    expect(formatMemoryForPrompt(root)).toEqual({ text: "", count: 0 });
  });

  it("appends a single entry and round-trips it", () => {
    const root = mkdtemp();
    created.push(root);

    appendProjectMemory(root, {
      topic: "Should we use Postgres or Neon?",
      mode: "council",
      summary:
        "Council recommends Neon for serverless scaling. Trade-off: vendor lock-in.",
      debateId: "dbt_abc123",
    });

    expect(memoryFileExists(root)).toBe(true);
    const entries = loadProjectMemory(root);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.topic).toBe("Should we use Postgres or Neon?");
    expect(entries[0]?.mode).toBe("council");
    expect(entries[0]?.summary).toContain("Neon for serverless");
    expect(entries[0]?.debateId).toBe("dbt_abc123");
  });

  it("appends multiple entries in chronological order", () => {
    const root = mkdtemp();
    created.push(root);

    appendProjectMemory(root, {
      topic: "First",
      mode: "quick",
      summary: "one",
    });
    appendProjectMemory(root, {
      topic: "Second",
      mode: "auto",
      summary: "two",
    });
    appendProjectMemory(root, {
      topic: "Third",
      mode: "council",
      summary: "three",
    });

    const entries = loadProjectMemory(root);
    expect(entries.map((e) => e.topic)).toEqual(["First", "Second", "Third"]);
  });

  it("truncates oversized summaries when reading back", () => {
    const root = mkdtemp();
    created.push(root);

    const longText = "word ".repeat(2000);
    appendProjectMemory(root, {
      topic: "Long",
      mode: "deep",
      summary: longText,
    });

    const entries = loadProjectMemory(root);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.summary.length).toBeLessThanOrEqual(501); // 500 + ellipsis
  });

  it("formats prompt prefix with most recent N entries", () => {
    const root = mkdtemp();
    created.push(root);
    for (let i = 0; i < 8; i++) {
      appendProjectMemory(root, {
        topic: `Topic ${i}`,
        mode: "council",
        summary: `Decision ${i}`,
      });
    }
    const { text: prefix, count } = formatMemoryForPrompt(root, 3);
    expect(count).toBe(8);
    expect(prefix).toContain("Prior Council Decisions");
    expect(prefix).toContain("Topic 5");
    expect(prefix).toContain("Topic 6");
    expect(prefix).toContain("Topic 7");
    expect(prefix).not.toContain("Topic 0");
    expect(prefix).not.toContain("Topic 4");
  });

  it("memoryFilePath returns absolute path under .consilium/", () => {
    const root = mkdtemp();
    created.push(root);
    const p = memoryFilePath(root);
    expect(p).toBe(path.join(root, ".consilium", "memory.md"));
  });

  it("handles a corrupt memory file gracefully", () => {
    const root = mkdtemp();
    created.push(root);
    const dir = path.join(root, ".consilium");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "memory.md"),
      "not a valid memory file at all",
    );
    expect(loadProjectMemory(root)).toEqual([]);
    expect(formatMemoryForPrompt(root)).toEqual({ text: "", count: 0 });
  });
});
