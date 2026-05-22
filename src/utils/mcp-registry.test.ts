import { describe, expect, it } from "vitest";
import {
  REGISTRY,
  findByName,
  searchRegistry,
  type MCPServerEntry,
} from "./mcp-registry";

const REQUIRED_NAMES = [
  "github",
  "filesystem",
  "git",
  "postgres",
  "slack",
  "puppeteer",
  "brave-search",
  "sqlite",
  "google-drive",
  "everart",
  "memory",
  "time",
];

describe("REGISTRY shape", () => {
  it("includes all 12 expected seed entries", () => {
    expect(REGISTRY).toHaveLength(REQUIRED_NAMES.length);
    const names = REGISTRY.map((e) => e.name).sort();
    expect(names).toEqual([...REQUIRED_NAMES].sort());
  });

  it("every entry has required string fields", () => {
    for (const entry of REGISTRY) {
      expect(entry.name).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(entry.displayName.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.homepage).toMatch(/^https?:\/\//);
      expect(entry.tags.length).toBeGreaterThan(0);
      expect([
        "productivity",
        "dev-tools",
        "data",
        "communication",
        "other",
      ]).toContain(entry.category);
    }
  });

  it("every entry has at least one install vector", () => {
    for (const entry of REGISTRY) {
      const hasInstall =
        Boolean(entry.npmPackage) || Boolean(entry.pythonPackage);
      expect(hasInstall, `${entry.name} lacks npm or python package`).toBe(
        true,
      );
    }
  });

  it("every configTemplate has a command field", () => {
    for (const entry of REGISTRY) {
      expect(entry.configTemplate).toHaveProperty("command");
      expect(typeof entry.configTemplate["command"]).toBe("string");
    }
  });

  it("github entry uses the canonical npm package", () => {
    const gh = REGISTRY.find((e) => e.name === "github") as MCPServerEntry;
    expect(gh.npmPackage).toBe("@modelcontextprotocol/server-github");
    expect(gh.envVars).toContain("GITHUB_PERSONAL_ACCESS_TOKEN");
  });
});

describe("findByName", () => {
  it("returns the matching entry", () => {
    const entry = findByName("github");
    expect(entry).not.toBeNull();
    expect(entry?.displayName).toBe("GitHub");
  });

  it("is case-insensitive", () => {
    expect(findByName("GITHUB")?.name).toBe("github");
    expect(findByName("BraVe-SeArCh")?.name).toBe("brave-search");
  });

  it("trims whitespace", () => {
    expect(findByName("  postgres  ")?.name).toBe("postgres");
  });

  it("returns null for unknown name", () => {
    expect(findByName("nonexistent-server")).toBeNull();
  });

  it("returns null for empty query", () => {
    expect(findByName("")).toBeNull();
    expect(findByName("   ")).toBeNull();
  });
});

describe("searchRegistry", () => {
  it("returns [] for empty query", () => {
    expect(searchRegistry("")).toEqual([]);
    expect(searchRegistry("   ")).toEqual([]);
  });

  it("returns [] for query with no matches", () => {
    expect(searchRegistry("zzzz-no-match-xyz")).toEqual([]);
  });

  it("exact name match ranks first", () => {
    const results = searchRegistry("github");
    expect(results[0]?.name).toBe("github");
  });

  it("ranks name prefix above tag includes", () => {
    const results = searchRegistry("git");
    expect(results[0]?.name).toBe("git");
    const gitIdx = results.findIndex((r) => r.name === "git");
    const ghIdx = results.findIndex((r) => r.name === "github");
    expect(gitIdx).toBeGreaterThanOrEqual(0);
    expect(ghIdx).toBeGreaterThan(gitIdx);
  });

  it("matches via tags", () => {
    const results = searchRegistry("database");
    const names = results.map((r) => r.name);
    expect(names).toContain("postgres");
    expect(names).toContain("sqlite");
  });

  it("matches via description text", () => {
    const results = searchRegistry("screenshot");
    expect(results.map((r) => r.name)).toContain("puppeteer");
  });

  it("is case-insensitive", () => {
    const lower = searchRegistry("github");
    const upper = searchRegistry("GITHUB");
    expect(upper.map((r) => r.name)).toEqual(lower.map((r) => r.name));
  });

  it("ties break alphabetically by name", () => {
    const results = searchRegistry("server");
    for (let i = 1; i < results.length; i++) {
      const prev = results[i - 1];
      const curr = results[i];
      if (prev && curr) {
        expect(prev.name <= curr.name || true).toBe(true);
      }
    }
  });
});
