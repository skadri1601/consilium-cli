import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emitFinalJson,
  emitStreamEvent,
  isHeadlessFormat,
  isValidOutputFormatFlag,
  validateAgainstSchema,
} from "./output-formats";

describe("output-formats", () => {
  describe("isHeadlessFormat", () => {
    it("returns true for json and stream-json", () => {
      expect(isHeadlessFormat("json")).toBe(true);
      expect(isHeadlessFormat("stream-json")).toBe(true);
    });
    it("returns false for text", () => {
      expect(isHeadlessFormat("text")).toBe(false);
    });
  });

  describe("isValidOutputFormatFlag", () => {
    it("accepts known formats", () => {
      expect(isValidOutputFormatFlag("text")).toBe(true);
      expect(isValidOutputFormatFlag("json")).toBe(true);
      expect(isValidOutputFormatFlag("stream-json")).toBe(true);
    });
    it("rejects unknown formats", () => {
      expect(isValidOutputFormatFlag("yaml")).toBe(false);
      expect(isValidOutputFormatFlag("")).toBe(false);
    });
  });

  describe("emitStreamEvent / emitFinalJson", () => {
    let writeSpy: ReturnType<typeof vi.spyOn>;
    let written: string[];

    beforeEach(() => {
      written = [];
      writeSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk: unknown) => {
          written.push(String(chunk));
          return true;
        });
    });

    afterEach(() => {
      writeSpy.mockRestore();
    });

    it("emitStreamEvent writes one JSON line per call", () => {
      emitStreamEvent({ type: "round.start", data: { round: 1 }, ts: 100 });
      emitStreamEvent({ type: "round.end", data: { round: 1 }, ts: 200 });
      expect(written).toHaveLength(2);
      const first = JSON.parse(written[0]!.trim());
      const second = JSON.parse(written[1]!.trim());
      expect(first).toEqual({
        type: "round.start",
        data: { round: 1 },
        ts: 100,
      });
      expect(second.type).toBe("round.end");
      expect(written[0]!.endsWith("\n")).toBe(true);
    });

    it("emitFinalJson writes one complete JSON object", () => {
      emitFinalJson({ synthesis: "answer", debateId: "abc" });
      expect(written).toHaveLength(1);
      expect(JSON.parse(written[0]!.trim())).toEqual({
        synthesis: "answer",
        debateId: "abc",
      });
    });
  });

  describe("validateAgainstSchema", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "consilium-of-test-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function writeSchema(schema: unknown): string {
      const p = path.join(tmpDir, "schema.json");
      fs.writeFileSync(p, JSON.stringify(schema), "utf-8");
      return p;
    }

    it("accepts a valid object", () => {
      const schemaPath = writeSchema({
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "integer" },
        },
        required: ["name"],
      });
      const result = validateAgainstSchema(
        { name: "Ada", age: 36 },
        schemaPath,
      );
      expect(result.ok).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it("rejects missing required fields", () => {
      const schemaPath = writeSchema({
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      });
      const result = validateAgainstSchema({}, schemaPath);
      expect(result.ok).toBe(false);
      expect(result.errors?.some((e) => e.includes("name"))).toBe(true);
    });

    it("rejects wrong type", () => {
      const schemaPath = writeSchema({
        type: "object",
        properties: { count: { type: "integer" } },
      });
      const result = validateAgainstSchema(
        { count: "not-a-number" },
        schemaPath,
      );
      expect(result.ok).toBe(false);
      expect(result.errors?.[0]).toMatch(/count/);
    });

    it("rejects integer when float given", () => {
      const schemaPath = writeSchema({
        type: "object",
        properties: { n: { type: "integer" } },
      });
      const result = validateAgainstSchema({ n: 3.14 }, schemaPath);
      expect(result.ok).toBe(false);
    });

    it("validates nested objects", () => {
      const schemaPath = writeSchema({
        type: "object",
        properties: {
          inner: {
            type: "object",
            properties: { x: { type: "string" } },
            required: ["x"],
          },
        },
        required: ["inner"],
      });
      const ok = validateAgainstSchema({ inner: { x: "y" } }, schemaPath);
      const bad = validateAgainstSchema({ inner: {} }, schemaPath);
      expect(ok.ok).toBe(true);
      expect(bad.ok).toBe(false);
      expect(bad.errors?.[0]).toMatch(/inner.*x/);
    });

    it("returns errors for unreadable schema file", () => {
      const result = validateAgainstSchema(
        {},
        path.join(tmpDir, "does-not-exist.json"),
      );
      expect(result.ok).toBe(false);
      expect(result.errors?.[0]).toMatch(/schema/);
    });

    it("returns errors for invalid JSON in schema", () => {
      const p = path.join(tmpDir, "bad.json");
      fs.writeFileSync(p, "{not json", "utf-8");
      const result = validateAgainstSchema({}, p);
      expect(result.ok).toBe(false);
      expect(result.errors?.[0]).toMatch(/parse/);
    });
  });
});
