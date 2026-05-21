import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyEdits, parseEditsFromSynthesis } from "./apply-edits";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "consilium-cli-test-"));
}

describe("apply-edits", () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    for (const dir of createdDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    createdDirs.length = 0;
  });

  it("parses and applies edits to disk", () => {
    const root = makeTempDir();
    createdDirs.push(root);
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "src", "file.ts"),
      "export const oldValue = 1;\n",
      "utf-8",
    );

    const synthesis = [
      "```consilium-edits",
      "[",
      '  {"path":"src/file.ts","content":"export const newValue = 2;\\n"}',
      "]",
      "```",
    ].join("\n");

    const parsed = parseEditsFromSynthesis(synthesis, root);
    expect(parsed.edits).toHaveLength(1);

    const result = applyEdits(root, parsed.edits);
    expect(result.applied).toBe(1);
    expect(result.snapshot.id).toContain("edit_");
    const content = fs.readFileSync(path.join(root, "src", "file.ts"), "utf-8");
    expect(content).toContain("newValue");
  });
});
