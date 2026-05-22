import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loadCustomCommands,
  executeCustomCommand,
  getCustomCommandsDir,
} from "./custom-commands";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "consilium-cmds-"));
});

afterEach(() => {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("getCustomCommandsDir", () => {
  it("returns a path under the user's home directory", () => {
    const dir = getCustomCommandsDir();
    expect(dir).toContain(os.homedir());
    expect(dir).toContain(".consilium");
    expect(dir).toContain("commands");
  });
});

describe("loadCustomCommands", () => {
  it("returns empty array when directory does not exist", async () => {
    const ghost = path.join(tmpDir, "does-not-exist");
    const result = await loadCustomCommands(ghost);
    expect(result).toEqual([]);
  });

  it("loads .md command files sorted alphabetically", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "review.md"),
      "# Review code\nDo a review",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "alpha.md"),
      "# Alpha command\nbody",
      "utf-8",
    );
    const result = await loadCustomCommands(tmpDir);
    expect(result.map((c) => c.name)).toEqual(["alpha", "review"]);
    expect(result[0]?.description).toBe("Alpha command");
    expect(result[1]?.description).toBe("Review code");
  });

  it("extracts description from explicit description marker", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "marked.md"),
      "# Description: A marked command\nBody here",
      "utf-8",
    );
    const result = await loadCustomCommands(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]?.description).toBe("A marked command");
  });

  it("ignores non-.md files", async () => {
    fs.writeFileSync(path.join(tmpDir, "noop.txt"), "ignored", "utf-8");
    fs.writeFileSync(path.join(tmpDir, "valid.md"), "# valid", "utf-8");
    const result = await loadCustomCommands(tmpDir);
    expect(result.map((c) => c.name)).toEqual(["valid"]);
  });

  it("ignores files with names containing invalid chars", async () => {
    fs.writeFileSync(path.join(tmpDir, "bad name.md"), "# bad", "utf-8");
    fs.writeFileSync(path.join(tmpDir, "ok.md"), "# ok", "utf-8");
    const result = await loadCustomCommands(tmpDir);
    expect(result.map((c) => c.name)).toEqual(["ok"]);
  });

  it("ignores subdirectories that end in .md", async () => {
    fs.mkdirSync(path.join(tmpDir, "subdir.md"));
    fs.writeFileSync(path.join(tmpDir, "real.md"), "# real", "utf-8");
    const result = await loadCustomCommands(tmpDir);
    expect(result.map((c) => c.name)).toEqual(["real"]);
  });

  it("returns description as undefined for command files with no leading header", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "headerless.md"),
      "just some content",
      "utf-8",
    );
    const result = await loadCustomCommands(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]?.description).toBeUndefined();
  });

  it("matches the html description comment format", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "html.md"),
      "<!-- description: HTML marked -->\nMain body",
      "utf-8",
    );
    const result = await loadCustomCommands(tmpDir);
    expect(result[0]?.description).toBe("HTML marked");
  });
});

describe("executeCustomCommand", () => {
  it("substitutes $ARGUMENTS with the given argument string", () => {
    const cmd = {
      name: "echo",
      filePath: "/tmp/echo.md",
      template: "Run: $ARGUMENTS",
    };
    expect(executeCustomCommand(cmd, "hello world")).toBe("Run: hello world");
  });

  it("substitutes $ARGUMENTS with joined array arguments", () => {
    const cmd = {
      name: "echo",
      filePath: "/tmp/echo.md",
      template: "Args=$ARGUMENTS",
    };
    expect(executeCustomCommand(cmd, ["a", "b", "c"])).toBe("Args=a b c");
  });

  it("replaces multiple occurrences of $ARGUMENTS", () => {
    const cmd = {
      name: "twice",
      filePath: "/tmp/twice.md",
      template: "$ARGUMENTS / $ARGUMENTS",
    };
    expect(executeCustomCommand(cmd, "x")).toBe("x / x");
  });

  it("handles empty argument string", () => {
    const cmd = {
      name: "blank",
      filePath: "/tmp/blank.md",
      template: "before $ARGUMENTS after",
    };
    expect(executeCustomCommand(cmd, "")).toBe("before  after");
  });
});
