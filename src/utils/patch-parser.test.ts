import { describe, expect, it } from "vitest";
import { parseEditActions } from "./patch-parser";

describe("parseEditActions", () => {
  it("parses legacy {path, content} JSON as kind:write (back-compat)", () => {
    const input = [
      "Here are edits:",
      "```consilium-edits",
      "[",
      '  {"path":"src/a.ts","content":"export const a = 1;"}',
      "]",
      "```",
    ].join("\n");
    const edits = parseEditActions(input);
    expect(edits).toHaveLength(1);
    expect(edits[0]).toEqual({
      kind: "write",
      path: "src/a.ts",
      content: "export const a = 1;",
    });
  });

  it("parses ```file:<path> as whole-file write (preserves trailing newline)", () => {
    const input = ["```file:src/b.ts", "export const b = 2;", "```"].join("\n");
    const edits = parseEditActions(input);
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({
      kind: "write",
      path: "src/b.ts",
      content: "export const b = 2;\n",
    });
  });

  it("parses surgical {kind:edit, old_string, new_string} JSON", () => {
    const input = [
      "```consilium-edits",
      '[{"kind":"edit","path":"src/auth.ts","old_string":"function login","new_string":"async function login"}]',
      "```",
    ].join("\n");
    const edits = parseEditActions(input);
    expect(edits).toHaveLength(1);
    expect(edits[0]).toEqual({
      kind: "edit",
      path: "src/auth.ts",
      oldString: "function login",
      newString: "async function login",
      replaceAll: false,
    });
  });

  it("parses {kind:delete} JSON", () => {
    const input = [
      "```consilium-edits",
      '[{"kind":"delete","path":"src/old.ts"}]',
      "```",
    ].join("\n");
    const edits = parseEditActions(input);
    expect(edits).toHaveLength(1);
    expect(edits[0]).toEqual({ kind: "delete", path: "src/old.ts" });
  });

  it("parses ```consilium-edit:<path> SEARCH/REPLACE blocks", () => {
    const input = [
      "```consilium-edit:src/auth.ts",
      "<<<<<<< SEARCH",
      "function login()",
      "=======",
      "async function login()",
      ">>>>>>> REPLACE",
      "```",
    ].join("\n");
    const edits = parseEditActions(input);
    expect(edits).toHaveLength(1);
    expect(edits[0]).toEqual({
      kind: "edit",
      path: "src/auth.ts",
      oldString: "function login()",
      newString: "async function login()",
    });
  });

  it("supports replace_all flag in JSON", () => {
    const input = [
      "```consilium-edits",
      '[{"kind":"edit","path":"x.ts","old_string":"foo","new_string":"bar","replace_all":true}]',
      "```",
    ].join("\n");
    const edits = parseEditActions(input);
    expect(edits[0]).toMatchObject({
      kind: "edit",
      path: "x.ts",
      oldString: "foo",
      newString: "bar",
      replaceAll: true,
    });
  });

  it("returns empty array when no recognized format is present", () => {
    expect(parseEditActions("just prose, no fences")).toEqual([]);
    expect(parseEditActions("```text\nhi\n```")).toEqual([]);
  });
});
