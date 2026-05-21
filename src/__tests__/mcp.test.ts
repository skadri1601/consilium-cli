import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/config", () => ({
  loadConfig: vi.fn(),
  DEFAULT_API_ORIGIN: "https://api.myconsilium.xyz",
  DEFAULT_WEB_ORIGIN: "https://myconsilium.xyz",
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
}));

import { loadConfig } from "../utils/config";
import { mcpCommand } from "../commands/mcp";

const mockLoadConfig = vi.mocked(loadConfig);

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadConfig.mockReturnValue({
    apiUrl: "https://api.myconsilium.xyz",
    webUrl: "https://myconsilium.xyz",
    apiKey: "consilium_testtoken12345",
  });
});

describe("mcpCommand --json", () => {
  it("outputs valid JSON with mcpServers key", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) =>
      logs.push(args.join(" ")),
    );

    mcpCommand({ json: true });

    const output = logs.join("\n");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("mcpServers");
    expect(parsed.mcpServers).toHaveProperty("consilium");
    expect(parsed.mcpServers.consilium).toHaveProperty("command", "python");
  });

  it("includes CONSILIUM_API_URL in JSON env block", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) =>
      logs.push(args.join(" ")),
    );

    mcpCommand({ json: true });

    const parsed = JSON.parse(logs.join("\n"));
    expect(parsed.mcpServers.consilium.env.CONSILIUM_API_URL).toBe(
      "https://api.myconsilium.xyz",
    );
  });

  it("does not include the actual API key in JSON template", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) =>
      logs.push(args.join(" ")),
    );

    mcpCommand({ json: true });

    const parsed = JSON.parse(logs.join("\n"));
    expect(parsed.mcpServers.consilium.env.CONSILIUM_API_KEY).toBe(
      "${CONSILIUM_API_KEY}",
    );
  });
});

describe("mcpCommand (human output)", () => {
  it("prints auth instructions", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) =>
      logs.push(args.join(" ")),
    );

    mcpCommand({ json: false });

    const output = logs.join("\n");
    expect(output).toContain("consilium login");
  });

  it("shows API URL", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) =>
      logs.push(args.join(" ")),
    );

    mcpCommand({ json: false });

    expect(logs.join("\n")).toContain("https://api.myconsilium.xyz");
  });
});
