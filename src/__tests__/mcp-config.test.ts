import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "consilium-mcp-cfg-"));
  vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("mcp-client/config", () => {
  it("returns empty list when file does not exist", async () => {
    const mod = await import("../utils/mcp-client/config");
    expect(mod.listServers()).toEqual([]);
  });

  it("writes and reads a server entry", async () => {
    const mod = await import("../utils/mcp-client/config");
    mod.addServer({
      name: "filesystem",
      command: "mcp-filesystem",
      args: ["--root", "."],
    });
    const servers = mod.listServers();
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({
      name: "filesystem",
      command: "mcp-filesystem",
      args: ["--root", "."],
    });

    const raw = fs.readFileSync(
      path.join(tmpHome, ".consilium", "mcp-servers.json"),
      "utf-8",
    );
    expect(JSON.parse(raw).servers.filesystem).toMatchObject({
      command: "mcp-filesystem",
    });
  });

  it("rejects duplicate names via addServer", async () => {
    const mod = await import("../utils/mcp-client/config");
    mod.addServer({ name: "github", command: "gh-mcp" });
    expect(() => mod.addServer({ name: "github", command: "other" })).toThrow(
      /already exists/,
    );
  });

  it("rejects invalid names", async () => {
    const mod = await import("../utils/mcp-client/config");
    expect(() => mod.addServer({ name: "bad name", command: "x" })).toThrow(
      /invalid server name/,
    );
    expect(() => mod.addServer({ name: "", command: "x" })).toThrow();
  });

  it("rejects missing command", async () => {
    const mod = await import("../utils/mcp-client/config");
    expect(() => mod.addServer({ name: "foo", command: "" })).toThrow(
      /command is required/,
    );
  });

  it("removes a server and returns true; false when missing", async () => {
    const mod = await import("../utils/mcp-client/config");
    mod.addServer({ name: "linear", command: "linear-mcp" });
    expect(mod.removeServer("linear")).toBe(true);
    expect(mod.removeServer("linear")).toBe(false);
    expect(mod.listServers()).toEqual([]);
  });

  it("upsertServer replaces existing entries", async () => {
    const mod = await import("../utils/mcp-client/config");
    mod.addServer({ name: "sentry", command: "sentry-v1" });
    mod.upsertServer({
      name: "sentry",
      command: "sentry-v2",
      args: ["--tail"],
    });
    const got = mod.getServer("sentry");
    expect(got).toMatchObject({ command: "sentry-v2", args: ["--tail"] });
  });

  it("loadServers tolerates garbage JSON", async () => {
    fs.mkdirSync(path.join(tmpHome, ".consilium"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpHome, ".consilium", "mcp-servers.json"),
      "not json",
      "utf-8",
    );
    const mod = await import("../utils/mcp-client/config");
    expect(() => mod.listServers()).toThrow();
  });
});
