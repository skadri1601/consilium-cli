import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ChatSessionData, DebateRecord } from "../commands/chat-session";

export interface FrictionPattern {
  pattern:
    | "permission_repeatedly_denied"
    | "long_unresolved_debate"
    | "cost_overrun"
    | "repeated_topic";
  count: number;
  examples: string[];
  recommendation: string;
}

export interface SessionInsights {
  totalSessions: number;
  totalDebates: number;
  totalCostUsd: number;
  avgDebatesPerSession: number;
  topModes: Array<{ mode: string; count: number }>;
  topTopics: Array<{ topic: string; count: number }>;
  friction: FrictionPattern[];
  generatedAt: number;
}

interface AnalyzeOpts {
  sinceDays?: number;
  sessionDir?: string;
}

interface RawSession extends ChatSessionData {
  costUsd?: number;
  permissionEvents?: Array<{ scope: string; action: "allow" | "deny" }>;
  debateMeta?: Array<{
    rounds?: number;
    costUsd?: number;
    hitBudgetLimit?: boolean;
  }>;
}

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "we",
  "i",
  "is",
  "are",
  "be",
  "do",
  "does",
  "did",
  "should",
  "would",
  "could",
  "this",
  "that",
  "it",
  "as",
  "by",
  "at",
  "from",
  "but",
  "if",
  "what",
  "how",
  "why",
  "when",
  "where",
  "vs",
  "v",
  "over",
  "into",
  "out",
  "use",
  "using",
  "can",
  "will",
  "our",
  "my",
]);

function defaultSessionDir(): string {
  return path.join(os.homedir(), ".consilium", "sessions");
}

function readAllSessions(sessionDir: string): RawSession[] {
  if (!fs.existsSync(sessionDir)) return [];
  const files = fs.readdirSync(sessionDir).filter((f) => f.endsWith(".json"));
  const out: RawSession[] = [];
  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(sessionDir, f), "utf-8");
      const parsed = JSON.parse(raw) as RawSession;
      out.push(parsed);
    } catch {
      // skip
    }
  }
  return out;
}

function tokenize(topic: string): string[] {
  return topic
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
}

function topCounts<T>(
  items: T[],
  keyFn: (t: T) => string | undefined,
  limit: number,
): Array<{ mode: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([mode, count]) => ({ mode, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (curr[j - 1] ?? 0) + 1,
        (prev[j] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j] ?? 0;
  }
  return prev[b.length] ?? 0;
}

function detectPermissionFriction(
  sessions: RawSession[],
): FrictionPattern | null {
  const denialsByScope = new Map<string, Set<string>>();
  for (const session of sessions) {
    for (const evt of session.permissionEvents ?? []) {
      if (evt.action !== "deny") continue;
      if (!denialsByScope.has(evt.scope))
        denialsByScope.set(evt.scope, new Set());
      denialsByScope.get(evt.scope)!.add(session.id);
    }
  }
  const offenders = [...denialsByScope.entries()].filter(
    ([, sessionIds]) => sessionIds.size > 2,
  );
  if (offenders.length === 0) return null;
  const examples = offenders
    .slice(0, 3)
    .map(
      ([scope, sessionIds]) =>
        `${scope} (denied in ${sessionIds.size} sessions)`,
    );
  return {
    pattern: "permission_repeatedly_denied",
    count: offenders.length,
    examples,
    recommendation:
      "Grant the scope once with /permissions allow to skip repeated prompts.",
  };
}

function detectLongDebate(sessions: RawSession[]): FrictionPattern | null {
  const examples: string[] = [];
  let total = 0;
  for (const session of sessions) {
    const metas = session.debateMeta ?? [];
    for (let i = 0; i < metas.length; i++) {
      const m = metas[i];
      if (!m) continue;
      if ((m.rounds ?? 0) > 5) {
        total++;
        if (examples.length < 3) {
          const topic = session.debates?.[i]?.topic ?? session.id;
          examples.push(`${topic.slice(0, 50)} (${m.rounds} rounds)`);
        }
      }
    }
  }
  if (total === 0) return null;
  return {
    pattern: "long_unresolved_debate",
    count: total,
    examples,
    recommendation:
      "Consider --max-turns 4 or running these in council mode for crisper synthesis.",
  };
}

function detectCostOverrun(sessions: RawSession[]): FrictionPattern | null {
  const examples: string[] = [];
  let total = 0;
  for (const session of sessions) {
    const metas = session.debateMeta ?? [];
    for (let i = 0; i < metas.length; i++) {
      const m = metas[i];
      if (!m?.hitBudgetLimit) continue;
      total++;
      if (examples.length < 3) {
        const topic = session.debates?.[i]?.topic ?? session.id;
        examples.push(`${topic.slice(0, 50)}`);
      }
    }
  }
  if (total === 0) return null;
  return {
    pattern: "cost_overrun",
    count: total,
    examples,
    recommendation:
      "Raise --max-budget or pick cheaper models (fast tier) for exploratory debates.",
  };
}

function detectRepeatedTopic(sessions: RawSession[]): FrictionPattern | null {
  const topics: Array<{ key: string; topic: string; sessionId: string }> = [];
  for (const session of sessions) {
    for (const debate of session.debates ?? []) {
      const key = (debate.topic || "").toLowerCase().slice(0, 30);
      if (key.length < 8) continue;
      topics.push({ key, topic: debate.topic, sessionId: session.id });
    }
  }
  const groups = new Map<string, string[]>();
  for (let i = 0; i < topics.length; i++) {
    const target = topics[i]!;
    let bucketKey = target.key;
    for (const existingKey of groups.keys()) {
      if (levenshtein(existingKey, target.key) < 5) {
        bucketKey = existingKey;
        break;
      }
    }
    if (!groups.has(bucketKey)) groups.set(bucketKey, []);
    groups.get(bucketKey)!.push(target.topic);
  }
  const repeats = [...groups.entries()].filter(([, items]) => items.length > 1);
  if (repeats.length === 0) return null;
  const examples = repeats
    .slice(0, 3)
    .map(([, items]) => `"${items[0]}" (asked ${items.length}x)`);
  return {
    pattern: "repeated_topic",
    count: repeats.length,
    examples,
    recommendation:
      "Use /memory to record the prior decision so the council does not re-derive it.",
  };
}

export async function analyzeSessions(
  opts: AnalyzeOpts = {},
): Promise<SessionInsights> {
  const sessionDir = opts.sessionDir ?? defaultSessionDir();
  const cutoff = opts.sinceDays
    ? Date.now() - opts.sinceDays * 24 * 60 * 60 * 1000
    : 0;
  const all = readAllSessions(sessionDir);
  const sessions = all.filter((s) => {
    if (!cutoff) return true;
    const ts = Date.parse(s.updatedAt || s.createdAt || "");
    return Number.isFinite(ts) ? ts >= cutoff : true;
  });

  const totalDebates = sessions.reduce(
    (acc, s) => acc + (s.debates?.length ?? 0),
    0,
  );
  const totalCostUsd = sessions.reduce((acc, s) => {
    const fromMeta = (s.debateMeta ?? []).reduce(
      (a, m) => a + (m?.costUsd ?? 0),
      0,
    );
    return acc + (s.costUsd ?? fromMeta);
  }, 0);

  const topModes = topCounts(sessions, (s) => s.mode, 5);

  const tokenCounts = new Map<string, number>();
  for (const session of sessions) {
    for (const debate of session.debates ?? []) {
      for (const tok of tokenize(debate.topic ?? "")) {
        tokenCounts.set(tok, (tokenCounts.get(tok) ?? 0) + 1);
      }
    }
  }
  const topTopics = [...tokenCounts.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const friction: FrictionPattern[] = [];
  for (const f of [
    detectPermissionFriction(sessions),
    detectLongDebate(sessions),
    detectCostOverrun(sessions),
    detectRepeatedTopic(sessions),
  ]) {
    if (f) friction.push(f);
  }

  const avgDebatesPerSession =
    sessions.length > 0 ? totalDebates / sessions.length : 0;

  return {
    totalSessions: sessions.length,
    totalDebates,
    totalCostUsd,
    avgDebatesPerSession,
    topModes,
    topTopics,
    friction,
    generatedAt: Date.now(),
  };
}

export function renderInsights(insights: SessionInsights): string {
  const lines: string[] = [];
  lines.push("Consilium session insights");
  lines.push("=".repeat(40));
  lines.push(`Sessions analyzed:  ${insights.totalSessions}`);
  lines.push(`Total debates:      ${insights.totalDebates}`);
  lines.push(
    `Avg debates/session: ${insights.avgDebatesPerSession.toFixed(1)}`,
  );
  if (insights.totalCostUsd > 0) {
    lines.push(`Total spend (USD):  $${insights.totalCostUsd.toFixed(2)}`);
  }
  lines.push("");
  if (insights.topModes.length > 0) {
    lines.push("Top modes:");
    for (const m of insights.topModes) {
      lines.push(`  - ${m.mode}: ${m.count}`);
    }
    lines.push("");
  }
  if (insights.topTopics.length > 0) {
    lines.push("Top topic terms:");
    for (const t of insights.topTopics.slice(0, 5)) {
      lines.push(`  - ${t.topic}: ${t.count}`);
    }
    lines.push("");
  }
  if (insights.friction.length === 0) {
    lines.push("No friction patterns detected. Smooth sailing.");
  } else {
    lines.push("Friction patterns:");
    for (const f of insights.friction) {
      lines.push(`  ${f.pattern} (${f.count})`);
      for (const ex of f.examples) lines.push(`    - ${ex}`);
      lines.push(`    -> ${f.recommendation}`);
    }
  }
  return lines.join("\n");
}

export function renderOnboardingGuide(insights: SessionInsights): string {
  const userName = process.env.USER || process.env.USERNAME || "Consilium user";
  const topMode = insights.topModes[0]?.mode;
  const sections: string[] = [];

  sections.push(`# Consilium Onboarding Guide for ${userName}`);
  sections.push("");
  sections.push(
    `Generated from ${insights.totalSessions} session(s) and ${insights.totalDebates} debate(s).`,
  );
  sections.push("");

  sections.push("## Your most-used modes");
  sections.push("");
  if (insights.topModes.length === 0) {
    sections.push("- (No mode usage recorded yet.)");
  } else {
    for (const m of insights.topModes.slice(0, 3)) {
      sections.push(`- \`${m.mode}\` (${m.count} session(s))`);
    }
  }
  sections.push("");

  sections.push("## Your most-debated topics");
  sections.push("");
  if (insights.topTopics.length === 0) {
    sections.push("- (No recurring topics yet.)");
  } else {
    for (const t of insights.topTopics.slice(0, 5)) {
      sections.push(`- ${t.topic} (${t.count} mentions)`);
    }
  }
  sections.push("");

  sections.push("## Friction patterns and how to avoid them");
  sections.push("");
  if (insights.friction.length === 0) {
    sections.push(
      "No friction patterns detected. Carry on; revisit this guide after another week.",
    );
  } else {
    for (const f of insights.friction) {
      sections.push(`### ${f.pattern.replace(/_/g, " ")}`);
      sections.push("");
      sections.push(`- Count: ${f.count}`);
      if (f.examples.length > 0) {
        sections.push("- Examples:");
        for (const ex of f.examples) sections.push(`  - ${ex}`);
      }
      sections.push(`- Recommendation: ${f.recommendation}`);
      sections.push("");
    }
  }

  sections.push("## Recommended config");
  sections.push("");
  if (topMode) {
    sections.push(
      `Your most-used mode is \`${topMode}\`. Set it as default in \`~/.consilium/config.json\`:`,
    );
    sections.push("");
    sections.push("```json");
    sections.push(
      JSON.stringify({ preferences: { defaultMode: topMode } }, null, 2),
    );
    sections.push("```");
  } else {
    sections.push("No mode preference suggested yet.");
  }
  sections.push("");

  sections.push("## Useful aliases");
  sections.push("");
  sections.push("Paste these into your shell rc file:");
  sections.push("");
  sections.push("```sh");
  sections.push("alias cs='consilium'");
  sections.push("alias csd='consilium debate'");
  sections.push("alias csc='consilium chat'");
  if (topMode) {
    sections.push(`alias cs${topMode}='consilium debate --mode ${topMode}'`);
  }
  sections.push("alias cssessions='consilium sessions list'");
  sections.push("```");
  sections.push("");

  return sections.join("\n");
}
