import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const TMP_HOME = vi.hoisted(() => {
  const base =
    process.env.TEMP || process.env.TMPDIR || process.env.TMP || "/tmp";
  return base.replace(/\\/g, "/") + `/consilium-grammar-test-${process.pid}`;
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

const PERM_DIR = path.join(TMP_HOME, ".consilium");

function cleanup() {
  if (fs.existsSync(PERM_DIR)) {
    fs.rmSync(PERM_DIR, { recursive: true, force: true });
  }
}

let mod: typeof import("./permission-grammar");

beforeEach(async () => {
  cleanup();
  vi.resetModules();
  mod = await import("./permission-grammar");
});

afterEach(() => {
  cleanup();
});

describe("parseRule", () => {
  it("parses Read(path) rules", () => {
    expect(mod.parseRule("Read(./src/*)")).toEqual({
      tool: "Read",
      pattern: "./src/*",
    });
  });

  it("parses Bash(command) rules with internal whitespace", () => {
    expect(mod.parseRule("Bash(npm run *)")).toEqual({
      tool: "Bash",
      pattern: "npm run *",
    });
  });

  it("parses WebFetch(domain:example.com) rules", () => {
    expect(mod.parseRule("WebFetch(domain:example.com)")).toEqual({
      tool: "WebFetch",
      pattern: "domain:example.com",
    });
  });

  it("parses Mcp(server/*) rules", () => {
    expect(mod.parseRule("Mcp(linear/*)")).toEqual({
      tool: "Mcp",
      pattern: "linear/*",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(mod.parseRule("  Write(./*.ts)  ")).toEqual({
      tool: "Write",
      pattern: "./*.ts",
    });
  });

  it("rejects malformed rules", () => {
    expect(() => mod.parseRule("not-a-rule")).toThrow(/Invalid permission/);
    expect(() => mod.parseRule("Read")).toThrow(/Invalid permission/);
    expect(() => mod.parseRule("Read()extra")).toThrow(/Invalid permission/);
  });

  it("rejects unknown tools", () => {
    expect(() => mod.parseRule("Magic(*)")).toThrow(/Invalid permission tool/);
  });
});

describe("matchesRule", () => {
  it("matches Read by path glob", () => {
    const rule = mod.parseRule("Read(./src/*)");
    expect(
      mod.matchesRule({ tool: "Read", target: "./src/index.ts" }, rule),
    ).toBe(true);
    expect(
      mod.matchesRule({ tool: "Read", target: "src/index.ts" }, rule),
    ).toBe(true);
    expect(
      mod.matchesRule({ tool: "Read", target: "./lib/index.ts" }, rule),
    ).toBe(false);
  });

  it("Write rule does not match Read action", () => {
    const rule = mod.parseRule("Write(./src/*)");
    expect(
      mod.matchesRule({ tool: "Read", target: "./src/index.ts" }, rule),
    ).toBe(false);
  });

  it("Bash matches prefix-glob", () => {
    const rule = mod.parseRule("Bash(npm run *)");
    expect(
      mod.matchesRule(
        { tool: "Bash", target: "npm run test -- --watch" },
        rule,
      ),
    ).toBe(true);
    expect(
      mod.matchesRule({ tool: "Bash", target: "pnpm run test" }, rule),
    ).toBe(false);
  });

  it("WebFetch with domain: matches URL hostname", () => {
    const rule = mod.parseRule("WebFetch(domain:example.com)");
    expect(
      mod.matchesRule(
        { tool: "WebFetch", target: "https://example.com/foo" },
        rule,
      ),
    ).toBe(true);
    expect(
      mod.matchesRule(
        { tool: "WebFetch", target: "https://other.com/foo" },
        rule,
      ),
    ).toBe(false);
  });

  it("WebFetch with hostname glob matches subdomains", () => {
    const rule = mod.parseRule("WebFetch(domain:*.example.com)");
    expect(
      mod.matchesRule(
        { tool: "WebFetch", target: "https://api.example.com/x" },
        rule,
      ),
    ).toBe(true);
  });

  it("WebFetch full-URL pattern works without domain prefix", () => {
    const rule = mod.parseRule("WebFetch(https://example.com/api/*)");
    expect(
      mod.matchesRule(
        { tool: "WebFetch", target: "https://example.com/api/list" },
        rule,
      ),
    ).toBe(true);
    expect(
      mod.matchesRule(
        { tool: "WebFetch", target: "https://example.com/other" },
        rule,
      ),
    ).toBe(false);
  });

  it("Mcp matches simple glob", () => {
    const rule = mod.parseRule("Mcp(linear/*)");
    expect(
      mod.matchesRule({ tool: "Mcp", target: "linear/list_issues" }, rule),
    ).toBe(true);
    expect(mod.matchesRule({ tool: "Mcp", target: "sentry/list" }, rule)).toBe(
      false,
    );
  });
});

describe("evaluate", () => {
  it("returns ask for empty rule set", () => {
    const empty: import("./permission-grammar").RuleSet = {
      allow: [],
      deny: [],
      ask: [],
    };
    expect(mod.evaluate({ tool: "Read", target: "./src/x.ts" }, empty)).toBe(
      "ask",
    );
  });

  it("deny beats allow when both match", () => {
    const rules: import("./permission-grammar").RuleSet = {
      allow: [mod.parseRule("Read(./*)")],
      deny: [mod.parseRule("Read(./secrets/*)")],
      ask: [],
    };
    expect(mod.evaluate({ tool: "Read", target: "./secrets/key" }, rules)).toBe(
      "deny",
    );
    expect(mod.evaluate({ tool: "Read", target: "./src/x.ts" }, rules)).toBe(
      "allow",
    );
  });

  it("ask beats allow when both match", () => {
    const rules: import("./permission-grammar").RuleSet = {
      allow: [mod.parseRule("Bash(*)")],
      deny: [],
      ask: [mod.parseRule("Bash(rm *)")],
    };
    expect(mod.evaluate({ tool: "Bash", target: "rm -rf /" }, rules)).toBe(
      "ask",
    );
    expect(mod.evaluate({ tool: "Bash", target: "ls -la" }, rules)).toBe(
      "allow",
    );
  });

  it("priority order is deny -> ask -> allow", () => {
    const rules: import("./permission-grammar").RuleSet = {
      allow: [mod.parseRule("Bash(*)")],
      deny: [mod.parseRule("Bash(rm *)")],
      ask: [mod.parseRule("Bash(rm *)")],
    };
    expect(mod.evaluate({ tool: "Bash", target: "rm file" }, rules)).toBe(
      "deny",
    );
  });
});

describe("loadRulesFromConfig", () => {
  it("returns empty rule set when file missing", () => {
    const rules = mod.loadRulesFromConfig();
    expect(rules).toEqual({ allow: [], deny: [], ask: [] });
  });

  it("parses rules block in permissions.json", () => {
    fs.mkdirSync(PERM_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(PERM_DIR, "permissions.json"),
      JSON.stringify({
        version: 2,
        projects: {},
        rules: {
          allow: ["Read(./src/*)"],
          deny: ["Read(./secrets/*)"],
          ask: ["Bash(rm *)"],
        },
      }),
      "utf-8",
    );
    const rules = mod.loadRulesFromConfig();
    expect(rules.allow).toHaveLength(1);
    expect(rules.allow[0]).toEqual({ tool: "Read", pattern: "./src/*" });
    expect(rules.deny[0]?.pattern).toBe("./secrets/*");
    expect(rules.ask[0]).toEqual({ tool: "Bash", pattern: "rm *" });
  });

  it("skips malformed entries silently", () => {
    fs.mkdirSync(PERM_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(PERM_DIR, "permissions.json"),
      JSON.stringify({
        rules: {
          allow: ["Read(./src/*)", "not-a-rule", "Magic(*)"],
          deny: [],
          ask: [],
        },
      }),
      "utf-8",
    );
    const rules = mod.loadRulesFromConfig();
    expect(rules.allow).toHaveLength(1);
    expect(rules.allow[0]?.tool).toBe("Read");
  });
});
