import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockListDebates,
  mockCancelDebate,
  mockCancelDeliberation,
  mockCreateDebate,
  mockStreamDebate,
  mockStreamDeliberation,
} = vi.hoisted(() => ({
  mockListDebates: vi.fn(),
  mockCancelDebate: vi.fn(),
  mockCancelDeliberation: vi.fn(),
  mockCreateDebate: vi.fn(),
  mockStreamDebate: vi.fn(),
  mockStreamDeliberation: vi.fn(),
}));

vi.mock("../api/client", () => ({
  ConsiliumClient: vi.fn(function () {
    return {
      listDebates: mockListDebates,
      cancelDebate: mockCancelDebate,
      cancelDeliberation: mockCancelDeliberation,
      createDebate: mockCreateDebate,
      streamDebate: mockStreamDebate,
      streamDeliberation: mockStreamDeliberation,
    };
  }),
  StreamError: class StreamError extends Error {
    kind: string;
    constructor(message: string, kind: string) {
      super(message);
      this.kind = kind;
    }
  },
  ApiError: class ApiError extends Error {
    status: number;
    body: string;
    constructor(status: number, body: string, message?: string) {
      super(message ?? `HTTP ${status}: ${body}`);
      this.status = status;
      this.body = body;
    }
  },
}));

vi.mock("../commands/debate", () => ({
  loadWorkspaceContext: vi.fn().mockResolvedValue(null),
}));

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
}));

import {
  listDebatesCommand,
  cancelDebateCommand,
  startDebateCommand,
  streamDebateCommand,
} from "../commands/debates";

describe("listDebatesCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it("calls listDebates with parsed limit/offset/search", async () => {
    mockListDebates.mockResolvedValue([]);
    await listDebatesCommand({ limit: "5", offset: "10", search: "auth" });
    expect(mockListDebates).toHaveBeenCalledWith({
      limit: 5,
      offset: 10,
      search: "auth",
    });
  });

  it("clamps limit to 100 and rejects negative values", async () => {
    mockListDebates.mockResolvedValue([]);
    await listDebatesCommand({ limit: "500" });
    expect(mockListDebates).toHaveBeenCalledWith({
      limit: 100,
      offset: 0,
      search: undefined,
    });
    mockListDebates.mockClear();
    await listDebatesCommand({ limit: "-1", offset: "-5" });
    expect(mockListDebates).toHaveBeenCalledWith({
      limit: 20,
      offset: 0,
      search: undefined,
    });
  });

  it("emits JSON when --json is set", async () => {
    const debates = [
      { id: "dbt_1", topic: "x", mode: "council", status: "completed" },
    ];
    mockListDebates.mockResolvedValue(debates);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) =>
      logs.push(args.join(" ")),
    );
    await listDebatesCommand({ json: true });
    expect(JSON.parse(logs.join("\n"))).toEqual(debates);
  });

  it("prints a friendly empty message when no debates", async () => {
    mockListDebates.mockResolvedValue([]);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) =>
      logs.push(args.join(" ")),
    );
    await listDebatesCommand({});
    expect(logs.join("\n")).toContain("No debates found.");
  });

  it("sets exit code on error", async () => {
    mockListDebates.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await listDebatesCommand({});
    expect(process.exitCode).toBe(1);
  });
});

describe("cancelDebateCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it("cancels a classic debate by default", async () => {
    mockCancelDebate.mockResolvedValue(undefined);
    await cancelDebateCommand("dbt_1", {});
    expect(mockCancelDebate).toHaveBeenCalledWith("dbt_1");
    expect(mockCancelDeliberation).not.toHaveBeenCalled();
  });

  it("cancels a deliberation when flag set", async () => {
    mockCancelDeliberation.mockResolvedValue(undefined);
    await cancelDebateCommand("dlb_1", { deliberation: true });
    expect(mockCancelDeliberation).toHaveBeenCalledWith("dlb_1");
    expect(mockCancelDebate).not.toHaveBeenCalled();
  });

  it("sets exit code when cancel fails", async () => {
    mockCancelDebate.mockRejectedValue(new Error("nope"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await cancelDebateCommand("dbt_1", {});
    expect(process.exitCode).toBe(1);
  });
});

describe("startDebateCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it("creates a debate and prints ID in human mode", async () => {
    mockCreateDebate.mockResolvedValue({ id: "dbt_abc" });
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) =>
      logs.push(args.join(" ")),
    );
    await startDebateCommand("hello", {});
    expect(mockCreateDebate).toHaveBeenCalled();
    expect(logs.join("\n")).toContain("dbt_abc");
    expect(logs.join("\n")).toContain("consilium debates stream dbt_abc");
  });

  it("emits JSON when --json", async () => {
    mockCreateDebate.mockResolvedValue({ id: "dbt_xyz" });
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) =>
      logs.push(args.join(" ")),
    );
    await startDebateCommand("topic", {
      json: true,
      mode: "quick",
      models: ["a", "b"],
    });
    const parsed = JSON.parse(logs.join("\n"));
    expect(parsed).toMatchObject({
      id: "dbt_xyz",
      mode: "quick",
      models: ["a", "b"],
    });
  });

  it("falls back to default mode when given an invalid one", async () => {
    mockCreateDebate.mockResolvedValue({ id: "dbt_1" });
    await startDebateCommand("t", { mode: "bogus" });
    const call = mockCreateDebate.mock.calls[0]?.[0];
    expect(call?.mode).toBe("auto");
  });

  it("sets exit code when creation fails", async () => {
    mockCreateDebate.mockRejectedValue(new Error("kaboom"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await startDebateCommand("t", {});
    expect(process.exitCode).toBe(1);
  });

  it("prints auth-specific hint on 401 ApiError", async () => {
    const { ApiError } = await import("../api/client");
    mockCreateDebate.mockRejectedValue(new ApiError(401, "unauthorized"));
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args) =>
      errors.push(args.join(" ")),
    );
    await startDebateCommand("t", {});
    expect(errors.join("\n")).toContain("consilium login");
    expect(process.exitCode).toBe(1);
  });
});

describe("streamDebateCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it("calls streamDebate by default", async () => {
    mockStreamDebate.mockResolvedValue(undefined);
    await streamDebateCommand("dbt_1", {});
    expect(mockStreamDebate).toHaveBeenCalledWith(
      "dbt_1",
      expect.any(Function),
    );
    expect(mockStreamDeliberation).not.toHaveBeenCalled();
  });

  it("routes to streamDeliberation when flag set", async () => {
    mockStreamDeliberation.mockResolvedValue(undefined);
    await streamDebateCommand("dlb_1", { deliberation: true });
    expect(mockStreamDeliberation).toHaveBeenCalledWith(
      "dlb_1",
      expect.any(Function),
    );
    expect(mockStreamDebate).not.toHaveBeenCalled();
  });

  it("sets exit code when stream fails", async () => {
    mockStreamDebate.mockRejectedValue(new Error("dropped"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await streamDebateCommand("dbt_1", {});
    expect(process.exitCode).toBe(1);
  });
});
