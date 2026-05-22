import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockLoadConfig, mockSaveConfig, debateMock } = vi.hoisted(() => ({
  mockLoadConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
  debateMock: vi.fn(),
}));

vi.mock("../utils/config", () => ({
  loadConfig: mockLoadConfig,
  saveConfig: mockSaveConfig,
  DEFAULT_API_ORIGIN: "https://api.myconsilium.xyz",
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

vi.mock("./debate", () => ({
  debateCommand: debateMock,
}));

import {
  linearListCommand,
  linearViewCommand,
  linearCreateCommand,
  linearUpdateCommand,
  linearDebateCommand,
} from "./linear";
import type { LinearClient } from "../utils/linear-client";

interface MockClient {
  getTeam: ReturnType<typeof vi.fn>;
  listIssues: ReturnType<typeof vi.fn>;
  listMyIssues: ReturnType<typeof vi.fn>;
  getIssue: ReturnType<typeof vi.fn>;
  createIssue: ReturnType<typeof vi.fn>;
  updateIssue: ReturnType<typeof vi.fn>;
  addComment: ReturnType<typeof vi.fn>;
  whoAmI: ReturnType<typeof vi.fn>;
  findStateByName: ReturnType<typeof vi.fn>;
  findUserByEmail: ReturnType<typeof vi.fn>;
  findLabelByName: ReturnType<typeof vi.fn>;
}

function makeClient(): MockClient {
  return {
    getTeam: vi.fn(),
    listIssues: vi.fn(),
    listMyIssues: vi.fn(),
    getIssue: vi.fn(),
    createIssue: vi.fn(),
    updateIssue: vi.fn(),
    addComment: vi.fn(),
    whoAmI: vi.fn(),
    findStateByName: vi.fn(),
    findUserByEmail: vi.fn(),
    findLabelByName: vi.fn(),
  };
}

let logSpy: ReturnType<typeof vi.spyOn>;
let originalEnvKey: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = 0;
  mockLoadConfig.mockReturnValue({
    apiUrl: "https://api.test.example",
  });
  originalEnvKey = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = "lin_api_test";
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  if (originalEnvKey === undefined) {
    delete process.env.LINEAR_API_KEY;
  } else {
    process.env.LINEAR_API_KEY = originalEnvKey;
  }
  logSpy.mockRestore();
  process.exitCode = 0;
});

describe("linearListCommand", () => {
  it("calls listIssues with the team id and renders a table", async () => {
    const client = makeClient();
    client.getTeam.mockResolvedValue({
      id: "team-1",
      key: "MYC",
      name: "Consilium",
    });
    client.listIssues.mockResolvedValue([
      {
        id: "i1",
        identifier: "MYC-1",
        title: "First issue",
        state: "Todo",
        assignee: "Alice",
      },
      {
        id: "i2",
        identifier: "MYC-2",
        title: "Second issue",
        state: "In Progress",
        assignee: null,
      },
    ]);

    await linearListCommand({}, { client: client as unknown as LinearClient });

    expect(client.getTeam).toHaveBeenCalledWith("MYC");
    expect(client.listIssues).toHaveBeenCalledWith({
      teamId: "team-1",
      states: undefined,
    });
    expect(client.listMyIssues).not.toHaveBeenCalled();
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("MYC-1");
    expect(out).toContain("First issue");
    expect(out).toContain("MYC-2");
    expect(out).toContain("Second issue");
  });

  it("filters by state when --state is passed", async () => {
    const client = makeClient();
    client.getTeam.mockResolvedValue({
      id: "team-1",
      key: "MYC",
      name: "Consilium",
    });
    client.listIssues.mockResolvedValue([]);

    await linearListCommand(
      { state: "In Progress" },
      { client: client as unknown as LinearClient },
    );

    expect(client.listIssues).toHaveBeenCalledWith({
      teamId: "team-1",
      states: ["In Progress"],
    });
  });

  it("calls listMyIssues when --mine is passed", async () => {
    const client = makeClient();
    client.listMyIssues.mockResolvedValue([
      {
        id: "i9",
        identifier: "MYC-9",
        title: "Mine",
        state: "Todo",
        assignee: "Me",
      },
    ]);

    await linearListCommand(
      { mine: true },
      { client: client as unknown as LinearClient },
    );

    expect(client.listMyIssues).toHaveBeenCalled();
    expect(client.listIssues).not.toHaveBeenCalled();
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("MYC-9");
  });
});

describe("linearViewCommand", () => {
  it("calls getIssue with the normalized identifier MYC-1", async () => {
    const client = makeClient();
    client.getIssue.mockResolvedValue({
      id: "i1",
      identifier: "MYC-1",
      title: "View me",
      state: "Todo",
      assignee: "Alice",
      description: "Body text",
      priority: 2,
      labels: ["bug"],
      comments: [{ author: "Bob", body: "Looks good" }],
    });

    await linearViewCommand(
      "MYC-1",
      {},
      { client: client as unknown as LinearClient },
    );

    expect(client.getIssue).toHaveBeenCalledWith("MYC-1");
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("MYC-1: View me");
    expect(out).toContain("Body text");
    expect(out).toContain("Looks good");
  });

  it("accepts a numeric id and normalizes to MYC-<n>", async () => {
    const client = makeClient();
    client.getIssue.mockResolvedValue({
      id: "i1",
      identifier: "MYC-42",
      title: "Number form",
      state: "Done",
      assignee: null,
      description: "",
      priority: 0,
      labels: [],
      comments: [],
    });

    await linearViewCommand(
      "42",
      {},
      {
        client: client as unknown as LinearClient,
      },
    );
    expect(client.getIssue).toHaveBeenCalledWith("MYC-42");
  });

  it("exits 1 when called without an id", async () => {
    const client = makeClient();
    await linearViewCommand(
      "",
      {},
      {
        client: client as unknown as LinearClient,
      },
    );
    expect(process.exitCode).toBe(1);
  });
});

describe("linearCreateCommand", () => {
  it("creates an issue with parsed flags", async () => {
    const client = makeClient();
    client.getTeam.mockResolvedValue({
      id: "team-1",
      key: "MYC",
      name: "Consilium",
    });
    client.findLabelByName.mockResolvedValue({ id: "label-1", name: "bug" });
    client.findUserByEmail.mockResolvedValue({
      id: "user-1",
      email: "saad@myconsilium.xyz",
      name: "Saad",
    });
    client.createIssue.mockResolvedValue({
      id: "new-1",
      identifier: "MYC-100",
      title: "New issue",
      state: "Todo",
      assignee: "Saad",
      url: "https://linear.app/myc/issue/MYC-100",
    });

    await linearCreateCommand(
      "New issue",
      {
        description: "Some body",
        label: "bug",
        assignee: "saad@myconsilium.xyz",
      },
      { client: client as unknown as LinearClient },
    );

    expect(client.createIssue).toHaveBeenCalledWith({
      teamId: "team-1",
      title: "New issue",
      description: "Some body",
      labelIds: ["label-1"],
      assigneeId: "user-1",
    });
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("MYC-100");
  });

  it("warns but proceeds when label is missing", async () => {
    const client = makeClient();
    client.getTeam.mockResolvedValue({
      id: "team-1",
      key: "MYC",
      name: "Consilium",
    });
    client.findLabelByName.mockResolvedValue(null);
    client.createIssue.mockResolvedValue({
      id: "new-1",
      identifier: "MYC-101",
      title: "X",
      state: "Todo",
      assignee: null,
    });

    await linearCreateCommand(
      "X",
      { label: "nope" },
      { client: client as unknown as LinearClient },
    );

    expect(client.createIssue).toHaveBeenCalled();
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("not found");
  });

  it("exits 1 when title is empty", async () => {
    const client = makeClient();
    await linearCreateCommand(
      "",
      {},
      {
        client: client as unknown as LinearClient,
      },
    );
    expect(process.exitCode).toBe(1);
    expect(client.createIssue).not.toHaveBeenCalled();
  });
});

describe("linearUpdateCommand", () => {
  it("looks up state id then updates the issue", async () => {
    const client = makeClient();
    client.getIssue.mockResolvedValue({
      id: "i-uuid",
      identifier: "MYC-7",
      title: "Bug",
      state: "Todo",
      assignee: null,
      description: "",
      priority: 0,
      labels: [],
      comments: [],
    });
    client.getTeam.mockResolvedValue({
      id: "team-1",
      key: "MYC",
      name: "Consilium",
    });
    client.findStateByName.mockResolvedValue({
      id: "state-done",
      name: "Done",
    });
    client.updateIssue.mockResolvedValue({
      id: "i-uuid",
      identifier: "MYC-7",
      title: "Bug",
      state: "Done",
      assignee: null,
    });

    await linearUpdateCommand(
      "MYC-7",
      { state: "Done" },
      { client: client as unknown as LinearClient },
    );

    expect(client.findStateByName).toHaveBeenCalledWith("team-1", "Done");
    expect(client.updateIssue).toHaveBeenCalledWith("i-uuid", {
      stateId: "state-done",
    });
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("MYC-7");
    expect(out).toContain("Done");
  });

  it("warns and skips when no flags are passed", async () => {
    const client = makeClient();
    client.getIssue.mockResolvedValue({
      id: "i-uuid",
      identifier: "MYC-3",
      title: "X",
      state: "Todo",
      assignee: null,
      description: "",
      priority: 0,
      labels: [],
      comments: [],
    });
    client.getTeam.mockResolvedValue({
      id: "team-1",
      key: "MYC",
      name: "Consilium",
    });
    await linearUpdateCommand(
      "MYC-3",
      {},
      {
        client: client as unknown as LinearClient,
      },
    );
    expect(client.updateIssue).not.toHaveBeenCalled();
  });
});

describe("linearDebateCommand", () => {
  it("calls getIssue then invokes debateCommand with composed topic", async () => {
    const client = makeClient();
    client.getIssue.mockResolvedValue({
      id: "i1",
      identifier: "MYC-50",
      title: "Add auth flow",
      state: "Todo",
      assignee: "Alice",
      description: "We need OAuth.",
      priority: 1,
      labels: ["feature"],
      comments: [],
    });

    const debateStub = vi.fn().mockResolvedValue(undefined);

    await linearDebateCommand(
      "MYC-50",
      { mode: "council" },
      { client: client as unknown as LinearClient, debate: debateStub },
    );

    expect(client.getIssue).toHaveBeenCalledWith("MYC-50");
    expect(debateStub).toHaveBeenCalledTimes(1);
    const callArgs = debateStub.mock.calls[0]!;
    const topic = callArgs[0] as string;
    const opts = callArgs[1] as { mode?: string; ticket?: string };
    expect(topic).toContain("MYC-50: Add auth flow");
    expect(topic).toContain("We need OAuth.");
    expect(topic).toContain("feature");
    expect(opts.mode).toBe("council");
    expect(opts.ticket).toBe("MYC-50");
  });

  it("defaults mode to council when none given", async () => {
    const client = makeClient();
    client.getIssue.mockResolvedValue({
      id: "i1",
      identifier: "MYC-1",
      title: "X",
      state: "Todo",
      assignee: null,
      description: "",
      priority: 0,
      labels: [],
      comments: [],
    });
    const debateStub = vi.fn().mockResolvedValue(undefined);

    await linearDebateCommand(
      "MYC-1",
      {},
      { client: client as unknown as LinearClient, debate: debateStub },
    );

    const opts = debateStub.mock.calls[0]![1] as { mode?: string };
    expect(opts.mode).toBe("council");
  });
});

describe("Linear API key handling", () => {
  it("exits 1 with helpful error when LINEAR_API_KEY is missing", async () => {
    delete process.env.LINEAR_API_KEY;
    mockLoadConfig.mockReturnValue({ apiUrl: "https://api.test.example" });

    await linearListCommand({});

    expect(process.exitCode).toBe(1);
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("LINEAR_API_KEY");
    expect(out).toContain("linear.app/settings/api");
  });

  it("reads linearApiKey from config when env var is missing", async () => {
    delete process.env.LINEAR_API_KEY;
    mockLoadConfig.mockReturnValue({
      apiUrl: "https://api.test.example",
      linearApiKey: "lin_api_from_config",
    });

    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          data: {
            teams: { nodes: [{ id: "team-1", key: "MYC", name: "Consilium" }] },
            issues: { nodes: [] },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    try {
      await linearListCommand({});
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(fetchSpy).toHaveBeenCalled();
    const calls = fetchSpy.mock.calls as unknown as Array<unknown[]>;
    const init = calls[0]?.[1] as
      | { headers?: Record<string, string> }
      | undefined;
    expect(init?.headers?.Authorization).toBe("lin_api_from_config");
  });
});
