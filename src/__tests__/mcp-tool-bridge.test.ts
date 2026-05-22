import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockRegistryStartAll,
  mockRegistryListTools,
  mockRegistryCallTool,
  mockRegistryStopAll,
} = vi.hoisted(() => ({
  mockRegistryStartAll: vi.fn(),
  mockRegistryListTools: vi.fn(),
  mockRegistryCallTool: vi.fn(),
  mockRegistryStopAll: vi.fn(),
}));

vi.mock("../utils/mcp-client/registry", () => ({
  McpRegistry: vi.fn(function () {
    return {
      startAll: mockRegistryStartAll,
      listTools: mockRegistryListTools,
      callTool: mockRegistryCallTool,
      stopAll: mockRegistryStopAll,
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
}));

import { startToolBridge } from "../utils/mcp-tool-bridge";

const fakeClient = {
  postToolResult: vi.fn().mockResolvedValue(undefined),
} as unknown as import("../api/client").ConsiliumClient;

beforeEach(() => {
  vi.clearAllMocks();
  mockRegistryStartAll.mockResolvedValue({ started: [], failed: [] });
  mockRegistryListTools.mockReturnValue([]);
  mockRegistryStopAll.mockResolvedValue(undefined);
});

describe("startToolBridge", () => {
  it("returns null when disabled", async () => {
    const bridge = await startToolBridge(fakeClient, { enabled: false });
    expect(bridge).toBeNull();
    expect(mockRegistryStartAll).not.toHaveBeenCalled();
  });

  it("returns null when no tools are available and shuts down the registry", async () => {
    mockRegistryStartAll.mockResolvedValue({ started: [], failed: [] });
    mockRegistryListTools.mockReturnValue([]);
    const bridge = await startToolBridge(fakeClient, {
      enabled: true,
      quiet: true,
      builtinsEnabled: false,
    });
    expect(bridge).toBeNull();
    expect(mockRegistryStopAll).toHaveBeenCalled();
  });

  it("returns tools and budget when servers started successfully", async () => {
    mockRegistryStartAll.mockResolvedValue({
      started: ["filesystem"],
      failed: [],
    });
    mockRegistryListTools.mockReturnValue([
      {
        server: "filesystem",
        qualifiedName: "filesystem.read_file",
        tool: {
          name: "read_file",
          description: "Reads",
          inputSchema: { type: "object" },
        },
      },
    ]);
    const bridge = await startToolBridge(fakeClient, {
      enabled: true,
      quiet: true,
      builtinsEnabled: false,
    });
    expect(bridge).not.toBeNull();
    expect(bridge!.tools).toHaveLength(1);
    expect(bridge!.tools[0]!.qualifiedName).toBe("filesystem.read_file");
    expect(bridge!.toolBudget.maxCallsPerTurn).toBe(5);
    await bridge!.shutdown();
  });

  it("routes tool:call_request to registry.callTool and posts the result", async () => {
    mockRegistryStartAll.mockResolvedValue({ started: ["fs"], failed: [] });
    mockRegistryListTools.mockReturnValue([
      {
        server: "fs",
        qualifiedName: "fs.read",
        tool: { name: "read", inputSchema: { type: "object" } },
      },
    ]);
    mockRegistryCallTool.mockResolvedValue({
      content: [{ type: "text", text: "file contents" }],
      isError: false,
    });

    const bridge = await startToolBridge(fakeClient, {
      enabled: true,
      quiet: true,
      builtinsEnabled: false,
    });
    await bridge!.handleEvent(
      {
        type: "tool:call_request",
        callId: "call_1",
        name: "fs.read",
        arguments: { path: "x" },
      },
      "dlb_1",
    );

    expect(mockRegistryCallTool).toHaveBeenCalledWith("fs.read", { path: "x" });
    expect(fakeClient.postToolResult).toHaveBeenCalledWith("dlb_1", "call_1", {
      content: [{ type: "text", text: "file contents" }],
      isError: false,
    });
    await bridge!.shutdown();
  });

  it("posts isError:true when tool invocation throws", async () => {
    mockRegistryStartAll.mockResolvedValue({ started: ["fs"], failed: [] });
    mockRegistryListTools.mockReturnValue([
      {
        server: "fs",
        qualifiedName: "fs.read",
        tool: { name: "read", inputSchema: { type: "object" } },
      },
    ]);
    mockRegistryCallTool.mockRejectedValue(new Error("permission denied"));

    const bridge = await startToolBridge(fakeClient, {
      enabled: true,
      quiet: true,
      builtinsEnabled: false,
    });
    await bridge!.handleEvent(
      {
        type: "tool:call_request",
        callId: "call_2",
        name: "fs.read",
        arguments: {},
      },
      "dlb_1",
    );

    const call = (fakeClient.postToolResult as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    expect(call[2]).toMatchObject({
      isError: true,
      content: [
        { type: "text", text: expect.stringContaining("permission denied") },
      ],
    });
    await bridge!.shutdown();
  });

  it("ignores non-tool-call events", async () => {
    mockRegistryStartAll.mockResolvedValue({ started: ["fs"], failed: [] });
    mockRegistryListTools.mockReturnValue([
      {
        server: "fs",
        qualifiedName: "fs.read",
        tool: { name: "read", inputSchema: { type: "object" } },
      },
    ]);

    const bridge = await startToolBridge(fakeClient, {
      enabled: true,
      quiet: true,
      builtinsEnabled: false,
    });
    await bridge!.handleEvent({ type: "agent_chunk", text: "x" }, "dlb_1");
    expect(mockRegistryCallTool).not.toHaveBeenCalled();
    expect(fakeClient.postToolResult).not.toHaveBeenCalled();
    await bridge!.shutdown();
  });

  it("rejects calls beyond the total budget", async () => {
    mockRegistryStartAll.mockResolvedValue({ started: ["fs"], failed: [] });
    mockRegistryListTools.mockReturnValue([
      {
        server: "fs",
        qualifiedName: "fs.x",
        tool: { name: "x", inputSchema: {} },
      },
    ]);
    mockRegistryCallTool.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });

    const bridge = await startToolBridge(fakeClient, {
      enabled: true,
      quiet: true,
      builtinsEnabled: false,
    });
    for (let i = 0; i < 51; i++) {
      await bridge!.handleEvent(
        {
          type: "tool:call_request",
          callId: `call_${i}`,
          name: "fs.x",
          arguments: {},
        },
        "dlb_1",
      );
    }
    const lastCall = (
      fakeClient.postToolResult as ReturnType<typeof vi.fn>
    ).mock.calls.at(-1)!;
    expect(lastCall[2]).toMatchObject({
      isError: true,
      content: [
        { type: "text", text: expect.stringContaining("budget exhausted") },
      ],
    });
    await bridge!.shutdown();
  });
});
