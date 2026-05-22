import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDebate: vi.fn(),
  streamDebate: vi.fn(),
}));

vi.mock("../api/client", () => ({
  ConsiliumClient: vi.fn(function () {
    return {
      createDebate: mocks.createDebate,
      streamDebate: mocks.streamDebate,
      getApiUrl: () => "https://api.myconsilium.xyz",
    };
  }),
}));

import {
  buildPlanMarkdown,
  parsePlanFromSynthesis,
  runUltraPlan,
  slugify,
} from "./ultraplan";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "consilium-ultraplan-"));
  mocks.createDebate.mockReset();
  mocks.streamDebate.mockReset();
});

afterEach(() => {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("slugify", () => {
  it("lowercases, removes punctuation, and dashes spaces", () => {
    expect(slugify("Add /ultraplan slash command!")).toBe(
      "add-ultraplan-slash-command",
    );
  });

  it("falls back to 'plan' for empty input", () => {
    expect(slugify("   ")).toBe("plan");
  });
});

describe("parsePlanFromSynthesis", () => {
  it("extracts numbered task blocks with files and effort", () => {
    const synthesis = [
      "### Task 1: Add SSE proxy",
      "Wire the new endpoint into Fastify.",
      "**Files:** apps/api/src/main.ts, apps/api/src/sse.ts",
      "**Effort:** hours",
      "",
      "### Task 2: Update CLI",
      "Stream the new event in the chat REPL.",
      "Files: packages/cli/src/repl/index.ts",
      "Effort: minutes",
      "",
      "### Risks",
      "- Browser disconnects during long streams",
      "- 429 from upstream provider",
      "",
      "### Out of Scope",
      "- Refactoring the queue worker",
    ].join("\n");

    const { steps, risks, outOfScope } = parsePlanFromSynthesis(synthesis);

    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({
      id: 1,
      title: "Add SSE proxy",
      filesToTouch: ["apps/api/src/main.ts", "apps/api/src/sse.ts"],
      estimatedEffort: "hours",
    });
    expect(steps[1]).toMatchObject({
      id: 2,
      title: "Update CLI",
      filesToTouch: ["packages/cli/src/repl/index.ts"],
      estimatedEffort: "minutes",
    });
    expect(risks).toEqual([
      "Browser disconnects during long streams",
      "429 from upstream provider",
    ]);
    expect(outOfScope).toEqual(["Refactoring the queue worker"]);
  });

  it("falls back to numbered lines when no Task headings are present", () => {
    const synthesis = [
      "1. Sketch the API contract",
      "2. Implement the worker",
      "3. Wire the CLI",
    ].join("\n");
    const { steps } = parsePlanFromSynthesis(synthesis);
    expect(steps.map((s) => s.id)).toEqual([1, 2, 3]);
    expect(steps[0]?.title).toContain("Sketch the API contract");
  });
});

describe("buildPlanMarkdown", () => {
  it("produces a deterministic plan document with file map", () => {
    const md = buildPlanMarkdown(
      "Improve SSE reliability",
      [
        {
          id: 1,
          title: "Cap reconnect attempts",
          description: "Limit retries to 3 with exponential backoff.",
          filesToTouch: ["packages/cli/src/api/client.ts"],
          estimatedEffort: "hours",
        },
      ],
      ["Excess reconnects can drop messages"],
      ["Backend retry logic"],
    );
    expect(md).toContain("# Improve SSE reliability");
    expect(md).toContain("| Task | Files | Effort |");
    expect(md).toContain("### Task 1: Cap reconnect attempts");
    expect(md).toContain("**Effort:** hours");
    expect(md).toContain("## Risks");
    expect(md).toContain("- Excess reconnects can drop messages");
    expect(md).toContain("## Out of Scope");
    expect(md).toContain("- Backend retry logic");
  });
});

describe("runUltraPlan", () => {
  it("invokes createDebate with council mode and the user topic, then parses synthesis", async () => {
    mocks.createDebate.mockResolvedValue({ id: "debate-123" });
    mocks.streamDebate.mockImplementation(
      async (_id: string, onEvent: (event: unknown) => void) => {
        onEvent({
          type: "consensus",
          text: [
            "### Task 1: Add /ultraplan",
            "Implement the slash command.",
            "Files: packages/cli/src/utils/ultraplan.ts",
            "Effort: hours",
            "",
            "### Risks",
            "- Parsing drift",
          ].join("\n"),
        });
      },
    );

    const result = await runUltraPlan({
      topic: "Add ultraplan slash command",
      save: false,
    });

    expect(mocks.createDebate).toHaveBeenCalledTimes(1);
    const args = mocks.createDebate.mock.calls[0]![0] as {
      topic: string;
      mode: string;
      debateSource: string;
    };
    expect(args.mode).toBe("council");
    expect(args.debateSource).toBe("cli");
    expect(args.topic).toContain("Add ultraplan slash command");

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({
      id: 1,
      title: "Add /ultraplan",
      filesToTouch: ["packages/cli/src/utils/ultraplan.ts"],
      estimatedEffort: "hours",
    });
    expect(result.risks).toEqual(["Parsing drift"]);
    expect(result.markdown).toContain("# Add ultraplan slash command");
    expect(result.savedTo).toBeUndefined();
  });

  it("writes the plan to outputDir when save is true", async () => {
    mocks.createDebate.mockResolvedValue({ id: "debate-456" });
    mocks.streamDebate.mockImplementation(
      async (_id: string, onEvent: (event: unknown) => void) => {
        onEvent({
          type: "consensus",
          text: [
            "### Task 1: Persist plans",
            "Save plans to disk.",
            "Files: -",
            "Effort: minutes",
          ].join("\n"),
        });
      },
    );

    const today = new Date(Date.UTC(2026, 4, 20));
    const result = await runUltraPlan({
      topic: "Save plans automatically",
      save: true,
      outputDir: tmpDir,
      today,
    });

    expect(result.savedTo).toBeDefined();
    const expected = path.join(
      tmpDir,
      "2026-05-20-save-plans-automatically.md",
    );
    expect(result.savedTo).toBe(expected);
    expect(fs.existsSync(expected)).toBe(true);
    const content = fs.readFileSync(expected, "utf-8");
    expect(content).toContain("### Task 1: Persist plans");
  });

  it("falls back to accumulated agent_chunk text when no consensus event is emitted", async () => {
    mocks.createDebate.mockResolvedValue({ id: "debate-789" });
    mocks.streamDebate.mockImplementation(
      async (_id: string, onEvent: (event: unknown) => void) => {
        onEvent({ type: "agent_chunk", text: "### Task 1: Streamed plan\n" });
        onEvent({
          type: "agent_chunk",
          text: "Stream-only content.\nFiles: -\nEffort: hours\n",
        });
      },
    );

    const result = await runUltraPlan({ topic: "Streamed plan", save: false });
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.title).toBe("Streamed plan");
  });
});
