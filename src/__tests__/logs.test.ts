import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = vi.hoisted(() => {
  const base =
    process.env.TEMP || process.env.TMPDIR || process.env.TMP || "/tmp";
  return base.replace(/\\/g, "/") + `/consilium-logs-test-${process.pid}`;
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

vi.mock("../utils/require-auth", () => ({
  requireAuth: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../api/client", () => ({
  ConsiliumClient: vi.fn(function () {
    return {
      getApiUrl: () => "https://api.myconsilium.xyz",
      getDebateDetails: vi.fn().mockRejectedValue(new Error("not found")),
    };
  }),
}));

vi.mock("../utils/visual-system", () => ({
  style: () => ({
    brand: (s: string) => s,
    dim: (s: string) => s,
    bold: (s: string) => s,
    success: (s: string) => s,
    error: (s: string) => s,
    warning: (s: string) => s,
  }),
  border: (s: string) => `==${s}==`,
  borderBottom: () => "======",
  contentLine: (s: string) => `| ${s}`,
}));

const LOGS_DIR = TMP_HOME + "/.consilium/logs";

import { appendLog, logsCommand, type LogEntry } from "../commands/logs";

function cleanLogs() {
  if (fs.existsSync(LOGS_DIR)) {
    fs.rmSync(LOGS_DIR, { recursive: true, force: true });
  }
}

function todayFileName(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}.jsonl`;
}

beforeEach(() => {
  cleanLogs();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanLogs();
});

describe("appendLog", () => {
  it("creates the logs directory if missing", () => {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: "INFO",
      debateId: "test-001",
      message: "test message",
    };
    appendLog(entry);
    expect(fs.existsSync(LOGS_DIR)).toBe(true);
  });

  it("writes a JSONL line to today's file", () => {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: "INFO",
      debateId: "debate-abc",
      message: "started",
    };
    appendLog(entry);
    const file = path.join(LOGS_DIR, todayFileName());
    const content = fs.readFileSync(file, "utf-8").trim();
    const parsed = JSON.parse(content);
    expect(parsed.debateId).toBe("debate-abc");
    expect(parsed.level).toBe("INFO");
  });

  it("appends multiple entries", () => {
    const base: Omit<LogEntry, "message"> = {
      timestamp: new Date().toISOString(),
      level: "INFO",
      debateId: "debate-multi",
    };
    appendLog({ ...base, message: "first" });
    appendLog({ ...base, message: "second" });
    const file = path.join(LOGS_DIR, todayFileName());
    const lines = fs.readFileSync(file, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
  });
});

describe("logsCommand", () => {
  it('prints "no logs found" when debate has no local entries', async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) =>
      logs.push(args.join(" ")),
    );

    await logsCommand("nonexistent-id", {});
    expect(logs.join("\n")).toContain("No logs found");
  });

  it("displays local log entries for a known debate", async () => {
    const debateId = "debate-display";
    appendLog({
      timestamp: new Date().toISOString(),
      level: "INFO",
      debateId,
      message: "hello logs",
    });

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) =>
      logs.push(args.join(" ")),
    );

    await logsCommand(debateId, {});
    expect(logs.join("\n")).toContain("hello logs");
  });

  it("filters by level when --level option is set", async () => {
    const debateId = "debate-filter";
    appendLog({
      timestamp: new Date().toISOString(),
      level: "INFO",
      debateId,
      message: "info entry",
    });
    appendLog({
      timestamp: new Date().toISOString(),
      level: "ERROR",
      debateId,
      message: "error entry",
    });

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) =>
      logs.push(args.join(" ")),
    );

    await logsCommand(debateId, { level: "ERROR" });
    const output = logs.join("\n");
    expect(output).toContain("error entry");
    expect(output).not.toContain("info entry");
  });
});
