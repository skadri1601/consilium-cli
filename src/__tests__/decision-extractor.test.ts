import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./config", () => ({
  loadConfig: () => ({ apiUrl: "http://localhost:3000", apiKey: "test-key" }),
  DEFAULT_API_ORIGIN: "http://localhost:3000",
}));

import {
  DecisionLog,
  extractDecisionsFromText,
  type Decision,
  type SemanticExtractionResult,
} from "../utils/decision-extractor";

describe("DecisionLog", () => {
  let log: DecisionLog;

  beforeEach(() => {
    log = new DecisionLog();
  });

  describe("constructor", () => {
    it("creates empty log", () => {
      expect(log.decisions).toEqual([]);
      expect(log.lastExtraction).toBeNull();
    });
  });

  describe("toJSON / fromJSON", () => {
    it("round-trips empty log", () => {
      const json = log.toJSON();
      const restored = DecisionLog.fromJSON(json);
      expect(restored.decisions).toEqual([]);
      expect(restored.lastExtraction).toBeNull();
    });

    it("round-trips log with decisions", () => {
      const decision: Decision = {
        category: "AUTH",
        statement: "Use JWT tokens",
        confidence: "high",
        source: "auth debate",
        debateIndex: 1,
        status: "decided",
        supportingModels: ["gpt-4o", "claude-3"],
      };
      log.decisions.push(decision);

      const extraction: SemanticExtractionResult = {
        decisions: [
          {
            decision: "Use JWT",
            confidence: 0.9,
            supporting_models: ["gpt-4o"],
            category: "AUTH",
          },
        ],
        action_items: ["Implement JWT middleware"],
        key_disagreements: [],
        consensus_level: 0.85,
      };
      log.lastExtraction = extraction;

      const json = log.toJSON();
      const restored = DecisionLog.fromJSON(json);
      expect(restored.decisions).toHaveLength(1);
      expect(restored.decisions[0].category).toBe("AUTH");
      expect(restored.decisions[0].statement).toBe("Use JWT tokens");
      expect(restored.decisions[0].supportingModels).toEqual([
        "gpt-4o",
        "claude-3",
      ]);
      expect(restored.lastExtraction).toEqual(extraction);
    });

    it("handles missing fields in fromJSON", () => {
      const restored = DecisionLog.fromJSON({});
      expect(restored.decisions).toEqual([]);
      expect(restored.lastExtraction).toBeNull();
    });

    it("handles invalid decisions array", () => {
      const restored = DecisionLog.fromJSON({ decisions: "not-an-array" });
      expect(restored.decisions).toEqual([]);
    });
  });

  describe("resolveDecision", () => {
    it("supersedes open decisions and adds resolved one", () => {
      log.decisions.push({
        category: "DATABASE",
        statement: "Need to pick a database",
        confidence: "low",
        source: "topic",
        debateIndex: 0,
        status: "open",
      });

      log.resolveDecision("DATABASE", "Use PostgreSQL", 1);

      expect(log.decisions).toHaveLength(2);
      expect(log.decisions[0].status).toBe("superseded");
      expect(log.decisions[0].resolvedBy).toBe(1);
      expect(log.decisions[1].status).toBe("decided");
      expect(log.decisions[1].statement).toBe("Use PostgreSQL");
    });

    it("supersedes tentative decisions", () => {
      log.decisions.push({
        category: "API",
        statement: "Leaning toward REST",
        confidence: "medium",
        source: "topic",
        debateIndex: 0,
        status: "tentative",
      });

      log.resolveDecision("API", "Use GraphQL", 2);

      expect(log.decisions[0].status).toBe("superseded");
      expect(log.decisions[1].statement).toBe("Use GraphQL");
    });

    it("does not supersede already-decided items", () => {
      log.decisions.push({
        category: "AUTH",
        statement: "Use OAuth",
        confidence: "high",
        source: "topic",
        debateIndex: 0,
        status: "decided",
      });

      log.resolveDecision("AUTH", "Use SAML", 1);

      expect(log.decisions[0].status).toBe("decided");
      expect(log.decisions[0].statement).toBe("Use OAuth");
      expect(log.decisions).toHaveLength(2);
    });
  });

  describe("getContext", () => {
    it("returns header for empty log", () => {
      const context = log.getContext();
      expect(context).toContain("PREVIOUS CONTEXT");
    });

    it("includes decisions grouped by status", () => {
      log.decisions.push(
        {
          category: "AUTH",
          statement: "Use JWT",
          confidence: "high",
          source: "t",
          debateIndex: 0,
          status: "decided",
        },
        {
          category: "DB",
          statement: "Unclear",
          confidence: "low",
          source: "t",
          debateIndex: 0,
          status: "open",
        },
      );

      const context = log.getContext();
      expect(context).toContain("AUTH");
      expect(context).toContain("Use JWT");
      expect(context).toContain("DECIDED");
      expect(context).toContain("OPEN");
    });

    it("respects token budget", () => {
      for (let i = 0; i < 100; i++) {
        log.decisions.push({
          category: "GENERAL",
          statement: `Decision number ${i} with a fairly long statement to consume budget quickly`,
          confidence: "high",
          source: "topic",
          debateIndex: i,
          status: "decided",
        });
      }

      const context = log.getContext(50);
      expect(context.length).toBeLessThan(50 * 4 + 200);
    });

    it("includes extraction metadata", () => {
      log.lastExtraction = {
        decisions: [],
        action_items: ["Deploy to staging"],
        key_disagreements: ["Auth approach"],
        consensus_level: 0.75,
      };

      const context = log.getContext();
      expect(context).toContain("ACTION ITEMS");
      expect(context).toContain("Deploy to staging");
      expect(context).toContain("KEY DISAGREEMENTS");
      expect(context).toContain("Auth approach");
      expect(context).toContain("CONSENSUS LEVEL");
      expect(context).toContain("75%");
    });
  });
});

describe("extractDecisionsFromText", () => {
  it("extracts decided patterns", () => {
    const text = "We should use PostgreSQL for the database layer.";
    const decisions = extractDecisionsFromText(text, "db-topic", 0);

    expect(decisions.length).toBeGreaterThanOrEqual(1);
    expect(decisions[0].status).toBe("decided");
    expect(decisions[0].category).toBe("DATABASE");
  });

  it("extracts tentative patterns", () => {
    const text = "We might use Redis for caching purposes.";
    const decisions = extractDecisionsFromText(text, "cache-topic", 1);

    expect(decisions.length).toBeGreaterThanOrEqual(1);
    expect(decisions[0].status).toBe("tentative");
  });

  it("extracts open patterns", () => {
    const text = "We need to decide which authentication provider to use.";
    const decisions = extractDecisionsFromText(text, "auth-topic", 2);

    expect(decisions.length).toBeGreaterThanOrEqual(1);
    expect(decisions[0].status).toBe("open");
    expect(decisions[0].confidence).toBe("low");
  });

  it("returns empty for text without decisions", () => {
    const text = "The sky is blue today.";
    const decisions = extractDecisionsFromText(text, "weather", 0);
    expect(decisions).toEqual([]);
  });

  it("extracts multiple decisions from multi-sentence text", () => {
    const text =
      "We must use TypeScript for the API layer. " +
      "We could consider using Docker for deployment. " +
      "What testing framework should we adopt?";
    const decisions = extractDecisionsFromText(text, "stack", 0);

    expect(decisions.length).toBeGreaterThanOrEqual(2);

    const statuses = decisions.map((d) => d.status);
    expect(statuses).toContain("decided");
  });

  it("infers categories from keywords", () => {
    const text = "We should use rate limiting with a sliding window approach.";
    const decisions = extractDecisionsFromText(text, "perf", 0);

    expect(decisions.length).toBeGreaterThanOrEqual(1);
    expect(decisions[0].category).toBe("RATE_LIMITING");
  });

  it("assigns GENERAL when no keyword matches", () => {
    const text = "We recommend adopting a new workflow for reviews.";
    const decisions = extractDecisionsFromText(text, "process", 0);

    expect(decisions.length).toBeGreaterThanOrEqual(1);
    expect(decisions[0].category).toBe("GENERAL");
  });

  it('handles "decided on" pattern', () => {
    const text = "The team decided on using microservices architecture.";
    const decisions = extractDecisionsFromText(text, "arch", 0);

    expect(decisions.length).toBeGreaterThanOrEqual(1);
    expect(decisions[0].status).toBe("decided");
    expect(decisions[0].category).toBe("ARCHITECTURE");
  });

  it("strips trailing punctuation from statements", () => {
    const text = "We should use JWT tokens for authentication!";
    const decisions = extractDecisionsFromText(text, "auth", 0);

    expect(decisions.length).toBeGreaterThanOrEqual(1);
    expect(decisions[0].statement).not.toMatch(/[.!]$/);
  });

  it("preserves debateIndex on all extracted decisions", () => {
    const text = "We must use PostgreSQL. We should use Redis.";
    const decisions = extractDecisionsFromText(text, "stack", 5);

    for (const d of decisions) {
      expect(d.debateIndex).toBe(5);
    }
  });

  it("preserves source topic on all decisions", () => {
    const text = "We recommend using Docker for deployment.";
    const decisions = extractDecisionsFromText(text, "deploy-topic", 0);

    for (const d of decisions) {
      expect(d.source).toBe("deploy-topic");
    }
  });
});
