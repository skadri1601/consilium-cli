import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { findSubAgent, invokeSubAgent, loadUserSubAgents } from "./loader";

describe("sub-agents loader", () => {
  let tmpDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "consilium-sub-agents-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    for (const entry of fs.readdirSync(tmpDir)) {
      fs.rmSync(path.join(tmpDir, entry), { recursive: true, force: true });
    }
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  function writeAgent(name: string, content: string): string {
    const filePath = path.join(tmpDir, `${name}.md`);
    fs.writeFileSync(filePath, content, "utf-8");
    return filePath;
  }

  it("returns empty array when dir does not exist", async () => {
    const missing = path.join(tmpDir, "missing");
    const result = await loadUserSubAgents(missing);
    expect(result).toEqual([]);
  });

  it("parses markdown with frontmatter and inline allowed-tools array", async () => {
    writeAgent(
      "code-reviewer",
      [
        "---",
        "name: code-reviewer",
        "description: Reviews a diff for security issues",
        "model: claude-sonnet-4-6",
        "allowed-tools: [Read, Grep]",
        "---",
        "You are a security-focused code reviewer.",
        "",
        "Focus on input validation.",
      ].join("\n"),
    );
    const agents = await loadUserSubAgents(tmpDir);
    expect(agents).toHaveLength(1);
    const agent = agents[0]!;
    expect(agent.name).toBe("code-reviewer");
    expect(agent.description).toBe("Reviews a diff for security issues");
    expect(agent.model).toBe("claude-sonnet-4-6");
    expect(agent.allowedTools).toEqual(["Read", "Grep"]);
    expect(agent.systemPrompt).toContain("security-focused code reviewer");
    expect(agent.systemPrompt).toContain("input validation");
  });

  it("parses block-style allowed-tools list", async () => {
    writeAgent(
      "linter",
      [
        "---",
        "name: linter",
        "description: Lints code",
        "allowed-tools:",
        "  - Read",
        "  - Bash",
        "---",
        "Lint everything.",
      ].join("\n"),
    );
    const agents = await loadUserSubAgents(tmpDir);
    expect(agents).toHaveLength(1);
    expect(agents[0]!.allowedTools).toEqual(["Read", "Bash"]);
  });

  it("rejects files missing frontmatter", async () => {
    writeAgent("plain", "Just a body, no frontmatter at all.");
    const agents = await loadUserSubAgents(tmpDir);
    expect(agents).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    const message = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(message).toContain("missing frontmatter");
  });

  it("rejects files where frontmatter.name does not match filename", async () => {
    writeAgent(
      "expected-name",
      [
        "---",
        "name: different-name",
        "description: A mismatched agent",
        "---",
        "Body text.",
      ].join("\n"),
    );
    const agents = await loadUserSubAgents(tmpDir);
    expect(agents).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    const message = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(message).toContain("does not match filename");
  });

  it("rejects files missing required name or description", async () => {
    writeAgent(
      "incomplete",
      ["---", "name: incomplete", "---", "Missing description."].join("\n"),
    );
    const agents = await loadUserSubAgents(tmpDir);
    expect(agents).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("rejects files with empty body", async () => {
    writeAgent(
      "empty-body",
      ["---", "name: empty-body", "description: Has no body", "---", ""].join(
        "\n",
      ),
    );
    const agents = await loadUserSubAgents(tmpDir);
    expect(agents).toEqual([]);
  });

  it("skips non-.md files", async () => {
    fs.writeFileSync(path.join(tmpDir, "notes.txt"), "ignored", "utf-8");
    const agents = await loadUserSubAgents(tmpDir);
    expect(agents).toEqual([]);
  });

  it("sorts results by name", async () => {
    writeAgent("zeta", "---\nname: zeta\ndescription: Z\n---\nbody");
    writeAgent("alpha", "---\nname: alpha\ndescription: A\n---\nbody");
    const agents = await loadUserSubAgents(tmpDir);
    expect(agents.map((a) => a.name)).toEqual(["alpha", "zeta"]);
  });

  it("findSubAgent returns matching agent or null", async () => {
    writeAgent("needle", "---\nname: needle\ndescription: Find me\n---\nbody");
    const found = await findSubAgent("needle", tmpDir);
    expect(found?.name).toBe("needle");
    const missing = await findSubAgent("nope", tmpDir);
    expect(missing).toBeNull();
  });

  it("invokeSubAgent throws the documented backend-required error", async () => {
    await expect(invokeSubAgent("anything", "prompt")).rejects.toThrow(
      /backend support/,
    );
  });
});
