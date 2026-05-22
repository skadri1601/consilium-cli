import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { completionsCommand, installInstructions } from "./completions";

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPLETIONS_DIR = path.join(HERE, "..", "..", "completions");

beforeEach(() => {
  stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true as unknown as boolean);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  exitSpy = vi
    .spyOn(process, "exit")
    .mockImplementation(((_code?: number) => undefined) as never);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  errorSpy.mockRestore();
  exitSpy.mockRestore();
});

function collectStdout(): string {
  return stdoutSpy.mock.calls
    .map((c: unknown[]) => String(c[0] ?? ""))
    .join("");
}

describe("completionsCommand", () => {
  it("prints non-empty content for bash", async () => {
    await completionsCommand("bash");
    const out = collectStdout();
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain("_consilium_completion");
  });

  it("prints non-empty content for zsh including compdef", async () => {
    await completionsCommand("zsh");
    const out = collectStdout();
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain("compdef");
    expect(out).toContain("consilium");
  });

  it("prints non-empty content for fish including complete -c consilium", async () => {
    await completionsCommand("fish");
    const out = collectStdout();
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain("complete -c consilium");
  });

  it("exits 1 for an unknown shell and reports supported shells", async () => {
    await completionsCommand("powershell");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
    const errOut = errorSpy.mock.calls.flat().join("\n");
    expect(errOut).toContain("Unknown shell");
    expect(errOut).toContain("bash");
    expect(errOut).toContain("zsh");
    expect(errOut).toContain("fish");
  });

  it("exits 1 when the completion script file is missing", async () => {
    const target = path.join(COMPLETIONS_DIR, "consilium.bash");
    const backup = `${target}.bak`;
    const existed = fs.existsSync(target);
    if (existed) fs.renameSync(target, backup);
    try {
      await completionsCommand("bash");
      expect(exitSpy).toHaveBeenCalledWith(1);
      const errOut = errorSpy.mock.calls.flat().join("\n");
      expect(errOut).toContain("not found");
    } finally {
      if (existed && fs.existsSync(backup)) fs.renameSync(backup, target);
    }
  });
});

describe("installInstructions", () => {
  it("returns a bash install hint", () => {
    expect(installInstructions("bash")).toContain("bashrc");
    expect(installInstructions("bash")).toContain("consilium completions bash");
  });

  it("returns a zsh install hint", () => {
    expect(installInstructions("zsh")).toContain("fpath");
    expect(installInstructions("zsh")).toContain("_consilium");
  });

  it("returns a fish install hint", () => {
    expect(installInstructions("fish")).toContain(
      "fish/completions/consilium.fish",
    );
  });

  it("returns an empty string for an unknown shell", () => {
    expect(installInstructions("powershell")).toBe("");
  });
});
