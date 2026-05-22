import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  analyzeSessions,
  renderInsights,
  renderOnboardingGuide,
} from "./session-analytics";

let sessionDir: string;

function makeSession(
  id: string,
  overrides: Record<string, unknown> = {},
): void {
  const base = {
    id,
    name: id,
    debates: [],
    contextFilePaths: [],
    contextImagePaths: [],
    models: ["gpt-5.4"],
    mode: "council",
    decisions: {},
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-15T00:00:00.000Z",
    ...overrides,
  };
  fs.writeFileSync(
    path.join(sessionDir, `${id}.json`),
    JSON.stringify(base),
    "utf-8",
  );
}

beforeEach(() => {
  sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "consilium-sa-"));
});

afterEach(() => {
  if (fs.existsSync(sessionDir)) {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

describe("session-analytics", () => {
  it("returns zeroed insights when no sessions exist", async () => {
    const insights = await analyzeSessions({ sessionDir });
    expect(insights.totalSessions).toBe(0);
    expect(insights.totalDebates).toBe(0);
    expect(insights.avgDebatesPerSession).toBe(0);
    expect(insights.friction).toEqual([]);
  });

  it("aggregates totals across multiple sessions", async () => {
    makeSession("s1", {
      mode: "council",
      debates: [
        {
          topic: "How to design a database schema",
          timestamp: "2026-04-01T00:00:00Z",
        },
        {
          topic: "Choosing between auth providers",
          timestamp: "2026-04-02T00:00:00Z",
        },
      ],
    });
    makeSession("s2", {
      mode: "council",
      debates: [
        {
          topic: "Database schema design choices",
          timestamp: "2026-04-03T00:00:00Z",
        },
      ],
    });
    makeSession("s3", {
      mode: "quick",
      debates: [
        { topic: "Selecting CI tooling", timestamp: "2026-04-04T00:00:00Z" },
      ],
    });

    const insights = await analyzeSessions({ sessionDir });
    expect(insights.totalSessions).toBe(3);
    expect(insights.totalDebates).toBe(4);
    expect(insights.avgDebatesPerSession).toBeCloseTo(4 / 3);
    expect(insights.topModes[0]?.mode).toBe("council");
    expect(insights.topModes[0]?.count).toBe(2);
  });

  it("aggregates topic tokens from titles", async () => {
    makeSession("s1", {
      debates: [
        { topic: "database schema design", timestamp: "2026-04-01T00:00:00Z" },
        { topic: "database migration plan", timestamp: "2026-04-02T00:00:00Z" },
      ],
    });
    makeSession("s2", {
      debates: [
        {
          topic: "database connection pool sizing",
          timestamp: "2026-04-03T00:00:00Z",
        },
      ],
    });

    const insights = await analyzeSessions({ sessionDir });
    const dbTopic = insights.topTopics.find((t) => t.topic === "database");
    expect(dbTopic?.count).toBe(3);
  });

  it("detects permission_repeatedly_denied", async () => {
    for (const id of ["a", "b", "c", "d"]) {
      makeSession(`s_${id}`, {
        permissionEvents: [{ scope: "codebase", action: "deny" }],
      });
    }
    const insights = await analyzeSessions({ sessionDir });
    const friction = insights.friction.find(
      (f) => f.pattern === "permission_repeatedly_denied",
    );
    expect(friction).toBeDefined();
    expect(friction?.examples[0]).toContain("codebase");
  });

  it("does not flag permission denials below threshold", async () => {
    makeSession("s1", {
      permissionEvents: [{ scope: "write", action: "deny" }],
    });
    makeSession("s2", {
      permissionEvents: [{ scope: "write", action: "deny" }],
    });
    const insights = await analyzeSessions({ sessionDir });
    expect(
      insights.friction.find(
        (f) => f.pattern === "permission_repeatedly_denied",
      ),
    ).toBeUndefined();
  });

  it("detects long_unresolved_debate when rounds > 5", async () => {
    makeSession("s1", {
      debates: [
        {
          topic: "Deep architectural decision",
          timestamp: "2026-04-01T00:00:00Z",
        },
      ],
      debateMeta: [{ rounds: 7 }],
    });
    const insights = await analyzeSessions({ sessionDir });
    const friction = insights.friction.find(
      (f) => f.pattern === "long_unresolved_debate",
    );
    expect(friction).toBeDefined();
    expect(friction?.count).toBe(1);
    expect(friction?.examples[0]).toContain("7 rounds");
  });

  it("detects cost_overrun when budget limit was hit", async () => {
    makeSession("s1", {
      debates: [
        { topic: "Heavy synthesis", timestamp: "2026-04-01T00:00:00Z" },
      ],
      debateMeta: [{ hitBudgetLimit: true, costUsd: 4.2 }],
    });
    const insights = await analyzeSessions({ sessionDir });
    const friction = insights.friction.find(
      (f) => f.pattern === "cost_overrun",
    );
    expect(friction).toBeDefined();
    expect(insights.totalCostUsd).toBeCloseTo(4.2);
  });

  it("detects repeated_topic across sessions", async () => {
    makeSession("s1", {
      debates: [
        {
          topic: "Choosing the right database engine for the API",
          timestamp: "2026-04-01T00:00:00Z",
        },
      ],
    });
    makeSession("s2", {
      debates: [
        {
          topic: "Choosing the right database engine for the API tier",
          timestamp: "2026-04-02T00:00:00Z",
        },
      ],
    });
    const insights = await analyzeSessions({ sessionDir });
    const friction = insights.friction.find(
      (f) => f.pattern === "repeated_topic",
    );
    expect(friction).toBeDefined();
    expect(friction?.count).toBeGreaterThanOrEqual(1);
  });

  it("filters by sinceDays", async () => {
    const old = "2025-01-01T00:00:00.000Z";
    const recent = new Date().toISOString();
    makeSession("old", {
      createdAt: old,
      updatedAt: old,
      debates: [{ topic: "x", timestamp: old }],
    });
    makeSession("new", {
      createdAt: recent,
      updatedAt: recent,
      debates: [{ topic: "y", timestamp: recent }],
    });
    const insights = await analyzeSessions({ sessionDir, sinceDays: 7 });
    expect(insights.totalSessions).toBe(1);
  });

  it("renderInsights produces a non-empty text report", async () => {
    makeSession("s1", {
      debates: [
        {
          topic: "Some topic about databases",
          timestamp: "2026-04-01T00:00:00Z",
        },
      ],
    });
    const insights = await analyzeSessions({ sessionDir });
    const out = renderInsights(insights);
    expect(out).toContain("Consilium session insights");
    expect(out).toContain("Sessions analyzed:");
    expect(out).toContain("Top modes:");
  });

  it("renderOnboardingGuide produces a markdown doc with required sections", async () => {
    makeSession("s1", {
      mode: "council",
      debates: [
        { topic: "Database design choices", timestamp: "2026-04-01T00:00:00Z" },
        { topic: "Database migration plan", timestamp: "2026-04-02T00:00:00Z" },
      ],
    });
    const insights = await analyzeSessions({ sessionDir });
    const guide = renderOnboardingGuide(insights);
    expect(guide).toMatch(/^# Consilium Onboarding Guide for /);
    expect(guide).toContain("## Your most-used modes");
    expect(guide).toContain("## Your most-debated topics");
    expect(guide).toContain("## Friction patterns");
    expect(guide).toContain("## Recommended config");
    expect(guide).toContain("## Useful aliases");
    expect(guide).toContain("council");
    expect(guide).toContain("alias cs=");
  });
});
