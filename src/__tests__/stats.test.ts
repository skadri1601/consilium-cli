import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/require-auth", () => ({
  requireAuth: vi.fn().mockResolvedValue(undefined),
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
  border: (title: string) => `== ${title} ==`,
  borderBottom: () => "============",
  contentLine: (s: string) => `| ${s}`,
}));

const mockFetch = vi.fn();

vi.mock("../utils/config", () => ({
  loadConfig: () => ({
    apiUrl: "https://api.myconsilium.xyz",
    apiKey: "consilium_testkey12345",
  }),
  DEFAULT_API_ORIGIN: "https://api.myconsilium.xyz",
}));

vi.mock("../api/client", () => ({
  ConsiliumClient: vi.fn(function () {
    return {};
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});

import { statsCommand } from "../commands/stats";

describe("statsCommand", () => {
  it("prints error when API returns non-ok status", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve(""),
    });
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) =>
      logs.push(args.join(" ")),
    );

    await statsCommand();

    expect(logs.join("\n")).toContain("Stats unavailable");
  });

  it("prints error when fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) =>
      logs.push(args.join(" ")),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await statsCommand();

    expect(logs.join("\n")).toContain("Stats unavailable");
  });

  it("displays stats when API responds correctly", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          totalDebates: 42,
          totalCost: 1.2345,
          thisMonthCount: 10,
          avgCost: 0.0294,
          modelUsage: {
            "claude-haiku-4-5-20251001": 30,
            "gpt-5.4-mini": 12,
          },
        }),
    });

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) =>
      logs.push(args.join(" ")),
    );

    await statsCommand();

    const output = logs.join("\n");
    expect(output).toContain("42");
    expect(output).toContain("10");
    expect(output).toContain("claude-haiku-4-5-20251001");
  });

  it("handles zero cost gracefully", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          totalDebates: 0,
          totalCost: 0,
          thisMonthCount: 0,
          avgCost: 0,
          modelUsage: {},
        }),
    });

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) =>
      logs.push(args.join(" ")),
    );

    await statsCommand();

    expect(logs.join("\n")).toContain("$0.00");
  });
});
