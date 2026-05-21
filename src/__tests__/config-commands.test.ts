import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockUpdateConfig, mockGetConfigValue, mockListConfig } = vi.hoisted(
  () => ({
    mockUpdateConfig: vi.fn(),
    mockGetConfigValue: vi.fn(),
    mockListConfig: vi.fn(),
  }),
);

vi.mock("../utils/config", () => ({
  updateConfig: mockUpdateConfig,
  getConfigValue: mockGetConfigValue,
  listConfig: mockListConfig,
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

import {
  configSetCommand,
  configGetCommand,
  configListCommand,
} from "../commands/config";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("configSetCommand", () => {
  it("calls updateConfig with key and value", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    configSetCommand("apiKey", "consilium_abc123");
    expect(mockUpdateConfig).toHaveBeenCalledWith("apiKey", "consilium_abc123");
  });

  it("prints success message containing the key", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) =>
      logs.push(args.join(" ")),
    );
    configSetCommand("apiKey", "consilium_abc123");
    expect(logs.join("\n")).toContain("apiKey");
  });

  it("exits on error", () => {
    mockUpdateConfig.mockImplementation(() => {
      throw new Error("write failed");
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => configSetCommand("bad", "val")).toThrow("exit");
    exitSpy.mockRestore();
  });
});

describe("configGetCommand", () => {
  it("prints value when key is set", () => {
    mockGetConfigValue.mockReturnValue("https://api.myconsilium.xyz");
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) =>
      logs.push(args.join(" ")),
    );
    configGetCommand("apiUrl");
    expect(logs[0]).toBe("https://api.myconsilium.xyz");
  });

  it("prints warning when key is not set", () => {
    mockGetConfigValue.mockReturnValue(undefined);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) =>
      logs.push(args.join(" ")),
    );
    configGetCommand("missing");
    expect(logs.join("\n")).toContain("not set");
  });
});

describe("configListCommand", () => {
  it("lists all config keys", () => {
    mockListConfig.mockReturnValue({
      apiUrl: "https://api.myconsilium.xyz",
      userName: "Alice",
    });
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) =>
      logs.push(args.join(" ")),
    );
    configListCommand();
    const output = logs.join("\n");
    expect(output).toContain("apiUrl");
    expect(output).toContain("userName");
  });

  it("masks the apiKey display", () => {
    mockListConfig.mockReturnValue({
      apiKey: "consilium_supersecrettoken123456",
    });
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) =>
      logs.push(args.join(" ")),
    );
    configListCommand();
    const output = logs.join("\n");
    expect(output).not.toContain("supersecrettoken");
    expect(output).toContain("...");
  });

  it("shows empty state message when no config set", () => {
    mockListConfig.mockReturnValue({});
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) =>
      logs.push(args.join(" ")),
    );
    configListCommand();
    expect(logs.join("\n")).toContain("No configuration set");
  });
});
