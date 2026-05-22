import { describe, expect, it } from "vitest";
import {
  DEFAULT_STATUS_LINE_TEMPLATE,
  renderStatusLine,
  type StatusLineContext,
} from "./status-line";

describe("renderStatusLine", () => {
  it("substitutes all provided placeholders", () => {
    const ctx: StatusLineContext = {
      cwd: "/tmp/proj",
      branch: "main",
      model: "gpt-5.4-mini",
      tokensUsed: 1234,
      costUsd: 0.42,
    };
    const out = renderStatusLine(
      ctx,
      "{cwd} | {branch} | {model} | {tokens}/{cost}",
    );
    expect(out).toBe("/tmp/proj | main | gpt-5.4-mini | 1.2k/0.42");
  });

  it("renders missing values as '?'", () => {
    const ctx: StatusLineContext = { cwd: "/x" };
    const out = renderStatusLine(
      ctx,
      "{cwd} | {branch} | {model} | {tokens}/{cost} | {mode} | {sessionId}",
    );
    expect(out).toBe("/x | ? | ? | ?/? | ? | ?");
  });

  it("default template works with full context", () => {
    const ctx: StatusLineContext = {
      cwd: "/repo",
      branch: "feature/x",
      model: "claude-opus-4-7",
      costUsd: 1.2345,
    };
    const out = renderStatusLine(ctx);
    expect(out).toContain("/repo");
    expect(out).toContain("feature/x");
    expect(out).toContain("claude-opus-4-7");
    expect(out).toContain("$1.23");
  });

  it("default template renders question marks when context is empty", () => {
    const out = renderStatusLine({ cwd: "" });
    expect(out).toContain("?");
    expect(out).toBe(
      DEFAULT_STATUS_LINE_TEMPLATE.replace("{cwd}", "?")
        .replace("{branch}", "?")
        .replace("{model}", "?")
        .replace("{cost}", "?"),
    );
  });

  it("formats cost with 4 decimals when below one cent", () => {
    const out = renderStatusLine({ cwd: "/x", costUsd: 0.0042 }, "{cost}");
    expect(out).toBe("0.0042");
  });

  it("formats cost as 0.00 when exactly zero", () => {
    const out = renderStatusLine({ cwd: "/x", costUsd: 0 }, "{cost}");
    expect(out).toBe("0.00");
  });

  it("formats tokens with M suffix for millions", () => {
    const out = renderStatusLine(
      { cwd: "/x", tokensUsed: 2_500_000 },
      "{tokens}",
    );
    expect(out).toBe("2.5M");
  });

  it("formats small token counts without suffix", () => {
    const out = renderStatusLine({ cwd: "/x", tokensUsed: 42 }, "{tokens}");
    expect(out).toBe("42");
  });

  it("shortens home directory to ~", () => {
    const home = process.env.HOME || process.env.USERPROFILE;
    if (!home) return;
    const out = renderStatusLine({ cwd: `${home}/projects/foo` }, "{cwd}");
    expect(out.startsWith("~/")).toBe(true);
  });

  it("ignores unknown placeholders by leaving them as-is", () => {
    const out = renderStatusLine({ cwd: "/x" }, "{cwd} {nope}");
    expect(out).toBe("/x {nope}");
  });
});
