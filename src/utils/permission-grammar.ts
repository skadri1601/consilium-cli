import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PERMISSIONS_FILE = path.join(
  os.homedir(),
  ".consilium",
  "permissions.json",
);

export type PermissionTool = "Read" | "Write" | "Bash" | "WebFetch" | "Mcp";

export type Permission = {
  tool: PermissionTool;
  pattern: string;
};

export type RuleSet = {
  allow: Permission[];
  deny: Permission[];
  ask: Permission[];
};

const VALID_TOOLS = new Set<PermissionTool>([
  "Read",
  "Write",
  "Bash",
  "WebFetch",
  "Mcp",
]);

const RULE_PATTERN = /^([A-Za-z]+)\(([\s\S]*)\)$/;
const DOMAIN_PREFIX = "domain:";

function escapeRegexChar(ch: string): string {
  return ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function globToRegex(pattern: string, opts: { anchor: boolean }): RegExp {
  let body = "";
  for (const ch of pattern) {
    if (ch === "*") {
      body += ".*";
    } else if (ch === "?") {
      body += ".";
    } else {
      body += escapeRegexChar(ch);
    }
  }
  const source = opts.anchor ? `^${body}$` : `^${body}`;
  return new RegExp(source);
}

export function parseRule(rule: string): Permission {
  const trimmed = rule.trim();
  const match = RULE_PATTERN.exec(trimmed);
  if (!match) {
    throw new Error(
      `Invalid permission rule: "${rule}". Expected format Tool(pattern), e.g. Read(./src/*).`,
    );
  }
  const rawTool = match[1]!;
  const pattern = match[2]!;
  if (!VALID_TOOLS.has(rawTool as PermissionTool)) {
    throw new Error(
      `Invalid permission tool: "${rawTool}". Valid: ${Array.from(VALID_TOOLS).join(", ")}.`,
    );
  }
  return { tool: rawTool as PermissionTool, pattern };
}

function matchesPathLike(target: string, pattern: string): boolean {
  if (pattern === "*" || pattern === "**") return true;
  const re = globToRegex(pattern, { anchor: true });
  if (re.test(target)) return true;
  if (target.startsWith("./") && re.test(target.slice(2))) return true;
  if (pattern.startsWith("./")) {
    const re2 = globToRegex(pattern.slice(2), { anchor: true });
    if (re2.test(target)) return true;
  }
  return false;
}

function matchesBash(target: string, pattern: string): boolean {
  if (pattern === "*" || pattern === "**") return true;
  const re = globToRegex(pattern, { anchor: false });
  return re.test(target);
}

function matchesWebFetch(target: string, pattern: string): boolean {
  if (pattern.startsWith(DOMAIN_PREFIX)) {
    const domainPattern = pattern.slice(DOMAIN_PREFIX.length);
    let host = target;
    try {
      host = new URL(target).hostname;
    } catch {
      // not a full URL; treat target as hostname directly
    }
    const re = globToRegex(domainPattern, { anchor: true });
    return re.test(host);
  }
  if (pattern === "*" || pattern === "**") return true;
  const re = globToRegex(pattern, { anchor: true });
  return re.test(target);
}

function matchesMcp(target: string, pattern: string): boolean {
  if (pattern === "*" || pattern === "**") return true;
  const re = globToRegex(pattern, { anchor: true });
  return re.test(target);
}

export function matchesRule(
  action: { tool: PermissionTool; target: string },
  rule: Permission,
): boolean {
  if (action.tool !== rule.tool) return false;
  switch (rule.tool) {
    case "Read":
    case "Write":
      return matchesPathLike(action.target, rule.pattern);
    case "Bash":
      return matchesBash(action.target, rule.pattern);
    case "WebFetch":
      return matchesWebFetch(action.target, rule.pattern);
    case "Mcp":
      return matchesMcp(action.target, rule.pattern);
  }
}

export function evaluate(
  action: { tool: PermissionTool; target: string },
  rules: RuleSet,
): "allow" | "ask" | "deny" {
  for (const rule of rules.deny) {
    if (matchesRule(action, rule)) return "deny";
  }
  for (const rule of rules.ask) {
    if (matchesRule(action, rule)) return "ask";
  }
  for (const rule of rules.allow) {
    if (matchesRule(action, rule)) return "allow";
  }
  return "ask";
}

function parseRuleList(input: unknown): Permission[] {
  if (!Array.isArray(input)) return [];
  const out: Permission[] = [];
  for (const item of input) {
    if (typeof item !== "string") continue;
    try {
      out.push(parseRule(item));
    } catch {
      // skip invalid entries silently; loader is permissive
    }
  }
  return out;
}

export function loadRulesFromConfig(): RuleSet {
  const empty: RuleSet = { allow: [], deny: [], ask: [] };
  try {
    if (!fs.existsSync(PERMISSIONS_FILE)) return empty;
    const raw = JSON.parse(
      fs.readFileSync(PERMISSIONS_FILE, "utf-8"),
    ) as Record<string, unknown>;
    const rulesField = raw.rules;
    if (!rulesField || typeof rulesField !== "object") return empty;
    const block = rulesField as Record<string, unknown>;
    return {
      allow: parseRuleList(block.allow),
      deny: parseRuleList(block.deny),
      ask: parseRuleList(block.ask),
    };
  } catch {
    return empty;
  }
}
