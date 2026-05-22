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
  buildReviewMarkdown,
  parseReviewFromSynthesis,
  runUltraReview,
} from "./ultrareview";

beforeEach(() => {
  mocks.createDebate.mockReset();
  mocks.streamDebate.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseReviewFromSynthesis", () => {
  it("parses severity, file, line, comment and suggestion", () => {
    const synthesis = [
      "- [CRITICAL] apps/api/src/main.ts:42 - Auth bypass when header is missing :: Suggestion: Require Bearer token",
      "- [MAJOR] packages/cli/src/api/client.ts:120 - Retry loop ignores 429",
      "- [MINOR] docs/README.md:3 - Typo: 'recieve'",
      "",
      "Overall: Block on the auth bypass; the other items can land separately.",
    ].join("\n");

    const { issues, overallAssessment } = parseReviewFromSynthesis(synthesis);
    expect(issues).toHaveLength(3);
    expect(issues[0]).toEqual({
      severity: "critical",
      file: "apps/api/src/main.ts",
      line: 42,
      comment: "Auth bypass when header is missing",
      suggestion: "Require Bearer token",
    });
    expect(issues[1]).toMatchObject({
      severity: "major",
      file: "packages/cli/src/api/client.ts",
      line: 120,
    });
    expect(issues[2]).toMatchObject({ severity: "minor", line: 3 });
    expect(overallAssessment).toContain("Block on the auth bypass");
  });

  it("returns empty issues when no bullets match", () => {
    const { issues, overallAssessment } = parseReviewFromSynthesis(
      "No structured findings.\n\nOverall: Looks clean.",
    );
    expect(issues).toHaveLength(0);
    expect(overallAssessment).toContain("Looks clean");
  });
});

describe("buildReviewMarkdown", () => {
  it("groups issues by severity and surfaces the blocked banner", () => {
    const md = buildReviewMarkdown(
      [
        { severity: "minor", comment: "Naming nit", file: "a.ts", line: 1 },
        {
          severity: "critical",
          comment: "Hardcoded secret",
          file: "b.ts",
          line: 10,
          suggestion: "Move to env",
        },
      ],
      "Block on the hardcoded secret.",
      true,
      { branch: "feature/x" },
    );
    expect(md).toContain("# UltraReview");
    expect(md).toContain("**Branch:** `feature/x`");
    expect(md).toContain("**Status:** BLOCKED");
    expect(md).toContain("## Critical (1)");
    expect(md).toContain("## Minor (1)");
    expect(md.indexOf("## Critical")).toBeLessThan(md.indexOf("## Minor"));
    expect(md).toContain("Suggestion: Move to env");
  });
});

describe("runUltraReview", () => {
  it("sends the diff to a redteam debate and parses issues", async () => {
    mocks.createDebate.mockResolvedValue({ id: "review-1" });
    mocks.streamDebate.mockImplementation(
      async (_id: string, onEvent: (event: unknown) => void) => {
        onEvent({
          type: "consensus",
          text: [
            "- [CRITICAL] apps/api/src/main.ts:5 - Missing auth check :: Suggestion: Add guard",
            "- [MINOR] README.md:1 - Doc typo",
            "Overall: Block on auth.",
          ].join("\n"),
        });
      },
    );

    const result = await runUltraReview({
      diff: "diff --git a/apps/api/src/main.ts b/apps/api/src/main.ts\n+++ b/apps/api/src/main.ts\n@@\n+console.log('x')",
      branch: "feature/test",
    });

    expect(mocks.createDebate).toHaveBeenCalledTimes(1);
    const args = mocks.createDebate.mock.calls[0]![0] as {
      mode: string;
      topic: string;
      debateSource: string;
    };
    expect(args.mode).toBe("redteam");
    expect(args.debateSource).toBe("cli");
    expect(args.topic).toContain("--- DIFF ---");
    expect(args.topic).toContain("Branch under review: feature/test");

    expect(result.issues).toHaveLength(2);
    expect(result.blocked).toBe(true);
    expect(result.markdown).toContain("**Status:** BLOCKED");
    expect(result.overallAssessment).toContain("Block on auth");
  });

  it("returns an empty advisory result when no diff is available", async () => {
    const result = await runUltraReview({
      diff: "",
      diffProvider: () => null,
      branch: "main",
    });
    expect(mocks.createDebate).not.toHaveBeenCalled();
    expect(result.issues).toHaveLength(0);
    expect(result.blocked).toBe(false);
    expect(result.markdown).toContain("**Status:** Advisory");
  });

  it("marks the review unblocked when only non-critical issues are found", async () => {
    mocks.createDebate.mockResolvedValue({ id: "review-2" });
    mocks.streamDebate.mockImplementation(
      async (_id: string, onEvent: (event: unknown) => void) => {
        onEvent({
          type: "consensus",
          text: [
            "- [MAJOR] packages/cli/src/repl/index.ts:8 - Race in input handler",
            "- [MINOR] CHANGELOG.md:0 - Missing entry",
            "Overall: Address the race before merge but not blocking.",
          ].join("\n"),
        });
      },
    );

    const result = await runUltraReview({
      diff: "diff --git a/x b/x\n+++ b/x\n+1",
      branch: "feature/race",
    });
    expect(result.blocked).toBe(false);
    expect(result.markdown).toContain("**Status:** Advisory");
    expect(result.issues.some((i) => i.severity === "major")).toBe(true);
  });
});
