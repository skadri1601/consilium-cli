import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { StdioMcpClient } from "../utils/mcp-client/stdio-client";

const FAKE_SERVER_SRC = `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let req;
  try { req = JSON.parse(line); } catch { return; }
  if (req.method === "initialize") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { protocolVersion: "2025-03-26", capabilities: {} } }) + "\\n");
    return;
  }
  if (req.method === "notifications/initialized") return;
  if (req.method === "tools/list") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { tools: [
      { name: "echo", description: "Echo input", inputSchema: { type: "object" } },
      { name: "fail", description: "Always fails", inputSchema: { type: "object" } },
    ] } }) + "\\n");
    return;
  }
  if (req.method === "tools/call") {
    if (req.params.name === "echo") {
      const text = String(req.params.arguments?.text ?? "");
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { content: [{ type: "text", text }] } }) + "\\n");
      return;
    }
    if (req.params.name === "fail") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, error: { code: -32000, message: "boom" } }) + "\\n");
      return;
    }
  }
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "unknown" } }) + "\\n");
});
`;

let fakeServerPath: string;

beforeAll(() => {
  fakeServerPath = path.join(os.tmpdir(), `fake-mcp-${Date.now()}.cjs`);
  fs.writeFileSync(fakeServerPath, FAKE_SERVER_SRC);
});

afterAll(() => {
  try {
    fs.unlinkSync(fakeServerPath);
  } catch {
    /* ignore */
  }
});

describe("StdioMcpClient", () => {
  it("initializes, lists tools, calls a tool", async () => {
    const client = new StdioMcpClient({
      name: "fake",
      command: process.execPath,
      args: [fakeServerPath],
    });
    await client.start();
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["echo", "fail"]);

    const result = await client.callTool("echo", { text: "hello" });
    expect(result.content[0]).toMatchObject({ type: "text", text: "hello" });

    await client.stop();
  });

  it("surfaces server-side errors as McpClientError", async () => {
    const client = new StdioMcpClient({
      name: "fake",
      command: process.execPath,
      args: [fakeServerPath],
    });
    await client.start();
    await expect(client.callTool("fail", {})).rejects.toThrow(/boom/);
    await client.stop();
  });

  it("fails initialize when command does not exist", async () => {
    const client = new StdioMcpClient(
      {
        name: "bogus",
        command: "/nonexistent/binary/definitely-not-there",
      },
      { startupTimeoutMs: 2000 },
    );
    await expect(client.start()).rejects.toThrow();
  });

  it("throws if callTool invoked before start", async () => {
    const client = new StdioMcpClient({
      name: "fake",
      command: process.execPath,
      args: [fakeServerPath],
    });
    await expect(client.callTool("echo", {})).rejects.toThrow(
      /not initialized|process not started/,
    );
  });
});
