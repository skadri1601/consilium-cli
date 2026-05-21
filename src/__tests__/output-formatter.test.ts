import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  formatOutput,
  isValidOutputFormat,
  getDefaultFilename,
  getFileExtension,
  type OutputMetadata,
  type OutputFormat,
} from "../utils/output-formatter.js";

function meta(
  overrides: Partial<OutputMetadata> & { format: OutputFormat },
): OutputMetadata {
  return {
    topic: "Test Topic",
    models: ["claude-sonnet-4-6", "gpt-5.4"],
    ...overrides,
  };
}

describe("isValidOutputFormat", () => {
  it.each(["markdown", "cursorrules", "claude-md", "json", "text"] as const)(
    'accepts "%s"',
    (fmt) => {
      expect(isValidOutputFormat(fmt)).toBe(true);
    },
  );

  it.each(["yaml", "html", "", "Markdown", "JSON"])('rejects "%s"', (fmt) => {
    expect(isValidOutputFormat(fmt)).toBe(false);
  });
});

describe("getDefaultFilename", () => {
  it("returns slugified .md for markdown", () => {
    expect(getDefaultFilename("markdown", "My Cool Topic")).toBe(
      "my-cool-topic.md",
    );
  });

  it("returns .cursorrules for cursorrules", () => {
    expect(getDefaultFilename("cursorrules", "anything")).toBe(".cursorrules");
  });

  it("returns CLAUDE.md for claude-md", () => {
    expect(getDefaultFilename("claude-md", "anything")).toBe("CLAUDE.md");
  });

  it("returns slugified .json for json", () => {
    expect(getDefaultFilename("json", "API Design")).toBe("api-design.json");
  });

  it("returns slugified .txt for text", () => {
    expect(getDefaultFilename("text", "Notes & Ideas!")).toBe(
      "notes-ideas.txt",
    );
  });

  it("truncates long topics to 60 chars", () => {
    const long = "a".repeat(100);
    const filename = getDefaultFilename("text", long);
    const slug = filename.replace(".txt", "");
    expect(slug.length).toBeLessThanOrEqual(60);
  });

  it("strips leading and trailing special chars from slug", () => {
    expect(getDefaultFilename("text", "---hello---")).toBe("hello.txt");
  });
});

describe("getFileExtension", () => {
  it("returns .md for markdown", () =>
    expect(getFileExtension("markdown")).toBe(".md"));
  it("returns empty for cursorrules", () =>
    expect(getFileExtension("cursorrules")).toBe(""));
  it("returns .md for claude-md", () =>
    expect(getFileExtension("claude-md")).toBe(".md"));
  it("returns .json for json", () =>
    expect(getFileExtension("json")).toBe(".json"));
  it("returns .txt for text", () =>
    expect(getFileExtension("text")).toBe(".txt"));
});

describe("formatOutput", () => {
  const synthesis = "Line one\nLine two\nLine three";
  const timestamp = "2026-01-15T12:00:00.000Z";

  describe("text format", () => {
    it("returns synthesis unchanged", () => {
      const result = formatOutput(synthesis, meta({ format: "text" }));
      expect(result).toBe(synthesis);
    });
  });

  describe("markdown format", () => {
    it("includes topic as heading", () => {
      const result = formatOutput(
        synthesis,
        meta({ format: "markdown", timestamp }),
      );
      expect(result).toContain("# Test Topic");
    });

    it("includes models", () => {
      const result = formatOutput(
        synthesis,
        meta({ format: "markdown", timestamp }),
      );
      expect(result).toContain("claude-sonnet-4-6, gpt-5.4");
    });

    it("includes mode when provided", () => {
      const result = formatOutput(
        synthesis,
        meta({ format: "markdown", mode: "council", timestamp }),
      );
      expect(result).toContain("**Mode:** council");
    });

    it("includes debate ID when provided", () => {
      const result = formatOutput(
        synthesis,
        meta({ format: "markdown", debateId: "abc-123", timestamp }),
      );
      expect(result).toContain("**Debate ID:** abc-123");
    });

    it("omits mode line when not provided", () => {
      const result = formatOutput(
        synthesis,
        meta({ format: "markdown", timestamp }),
      );
      expect(result).not.toContain("**Mode:**");
    });

    it("includes synthesis content", () => {
      const result = formatOutput(
        synthesis,
        meta({ format: "markdown", timestamp }),
      );
      expect(result).toContain(synthesis);
    });
  });

  describe("json format", () => {
    it("returns valid JSON", () => {
      const result = formatOutput(
        synthesis,
        meta({ format: "json", timestamp }),
      );
      const parsed = JSON.parse(result);
      expect(parsed.topic).toBe("Test Topic");
      expect(parsed.models).toEqual(["claude-sonnet-4-6", "gpt-5.4"]);
      expect(parsed.synthesis).toBe(synthesis);
      expect(parsed.timestamp).toBe(timestamp);
    });

    it("sets mode to null when not provided", () => {
      const result = formatOutput(
        synthesis,
        meta({ format: "json", timestamp }),
      );
      const parsed = JSON.parse(result);
      expect(parsed.mode).toBeNull();
    });

    it("sets debateId to null when not provided", () => {
      const result = formatOutput(
        synthesis,
        meta({ format: "json", timestamp }),
      );
      const parsed = JSON.parse(result);
      expect(parsed.debateId).toBeNull();
    });

    it("includes mode when provided", () => {
      const result = formatOutput(
        synthesis,
        meta({ format: "json", mode: "deep", timestamp }),
      );
      expect(JSON.parse(result).mode).toBe("deep");
    });
  });

  describe("cursorrules format", () => {
    it("includes header comments", () => {
      const result = formatOutput(synthesis, meta({ format: "cursorrules" }));
      expect(result).toContain("# Generated by Consilium AI Council");
      expect(result).toContain("# Topic: Test Topic");
      expect(result).toContain("# Models: claude-sonnet-4-6, gpt-5.4");
    });

    it("wraps each non-empty line as a numbered rule", () => {
      const result = formatOutput(synthesis, meta({ format: "cursorrules" }));
      expect(result).toContain("## Rule 1");
      expect(result).toContain("## Rule 2");
      expect(result).toContain("## Rule 3");
    });

    it("skips empty lines", () => {
      const withBlanks = "Rule A\n\n\nRule B";
      const result = formatOutput(withBlanks, meta({ format: "cursorrules" }));
      expect(result).toContain("## Rule 1");
      expect(result).toContain("## Rule 2");
      expect(result).not.toContain("## Rule 3");
    });
  });

  describe("claude-md format", () => {
    it("includes header", () => {
      const result = formatOutput(synthesis, meta({ format: "claude-md" }));
      expect(result).toContain("# Generated by Consilium AI Council");
      expect(result).toContain("> Topic: Test Topic");
    });

    it("includes section headers", () => {
      const multiParagraph =
        "Para one\n\nPara two\n\nPara three\n\nPara four\n\nPara five\n\nPara six";
      const result = formatOutput(
        multiParagraph,
        meta({ format: "claude-md" }),
      );
      expect(result).toContain("## Project Decisions");
      expect(result).toContain("## Guidelines");
      expect(result).toContain("## Context");
    });

    it("ends with a newline", () => {
      const result = formatOutput(synthesis, meta({ format: "claude-md" }));
      expect(result.endsWith("\n")).toBe(true);
    });
  });
});
