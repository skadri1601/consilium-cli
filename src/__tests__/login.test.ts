import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockIsLoggedIn, mockLoadConfig, mockSaveConfig } = vi.hoisted(() => ({
  mockIsLoggedIn: vi.fn(),
  mockLoadConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
}));

vi.mock("../utils/config", () => ({
  isLoggedIn: mockIsLoggedIn,
  loadConfig: mockLoadConfig,
  saveConfig: mockSaveConfig,
  DEFAULT_API_ORIGIN: "https://api.myconsilium.xyz",
  DEFAULT_WEB_ORIGIN: "https://myconsilium.xyz",
}));

vi.mock("../utils/open-browser", () => ({
  openBrowser: vi.fn(),
}));

vi.mock("../utils/post-login-onboarding", () => ({
  printPostLoginProviderHints: vi.fn().mockResolvedValue(undefined),
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

vi.mock("node:readline", () => ({
  default: {
    createInterface: () => ({
      question: (_q: string, cb: (a: string) => void) => cb(""),
      on: (_event: string, cb: () => void) => {
        cb();
        return { question: vi.fn(), on: vi.fn(), close: vi.fn() };
      },
      close: vi.fn(),
    }),
  },
  createInterface: () => ({
    question: (_q: string, cb: (a: string) => void) => cb(""),
    on: (_event: string, cb: () => void) => {
      cb();
      return { question: vi.fn(), on: vi.fn(), close: vi.fn() };
    },
    close: vi.fn(),
  }),
}));

import { loginCommand } from "../commands/login";

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadConfig.mockReturnValue({
    apiUrl: "https://api.myconsilium.xyz",
    webUrl: "https://myconsilium.xyz",
  });
});

describe("loginCommand", () => {
  it("prints already-logged-in message when authenticated and no --force", async () => {
    mockIsLoggedIn.mockReturnValue(true);
    mockLoadConfig.mockReturnValue({
      apiUrl: "https://api.myconsilium.xyz",
      webUrl: "https://myconsilium.xyz",
      userName: "Alice",
      userEmail: "alice@example.com",
    });

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) =>
      logs.push(args.join(" ")),
    );

    await loginCommand();

    expect(logs.join("\n")).toContain("Already logged in");
  });

  it("proceeds with login flow (cancels on empty token) when --force is set", async () => {
    mockIsLoggedIn.mockReturnValue(true);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) =>
      logs.push(args.join(" ")),
    );

    await loginCommand({ force: true });

    expect(logs.join("\n")).toContain("cancelled");
  });

  it("shows login prompt when not authenticated", async () => {
    mockIsLoggedIn.mockReturnValue(false);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) =>
      logs.push(args.join(" ")),
    );

    await loginCommand();

    expect(logs.join("\n")).toContain("cancelled");
  });
});
