import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isPathTrusted,
  trustPath,
  untrustPath,
  listTrustedPaths,
  getTrustLevel,
  __setWorkspaceTrustFileForTests,
  __clearSessionTrustForTests,
} from "./workspace-trust";

let tmpDir: string;
let trustFile: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "consilium-trust-"));
  trustFile = path.join(tmpDir, "workspace-trust.json");
  __setWorkspaceTrustFileForTests(trustFile);
  __clearSessionTrustForTests();
});

afterEach(() => {
  __setWorkspaceTrustFileForTests(null);
  __clearSessionTrustForTests();
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("trustPath / isPathTrusted", () => {
  it("untrusted path returns false initially", () => {
    expect(isPathTrusted("/tmp/notrust")).toBe(false);
  });

  it("trusts a path with 'always' level (persisted)", () => {
    trustPath("/tmp/proj-a", "always");
    expect(isPathTrusted("/tmp/proj-a")).toBe(true);
    expect(fs.existsSync(trustFile)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(trustFile, "utf-8"));
    expect(raw.entries).toHaveLength(1);
    expect(raw.entries[0].level).toBe("always");
  });

  it("'session' trust is not written to disk", () => {
    trustPath("/tmp/proj-b", "session");
    expect(isPathTrusted("/tmp/proj-b")).toBe(true);
    expect(fs.existsSync(trustFile)).toBe(false);
  });

  it("session trust is cleared after __clearSessionTrustForTests", () => {
    trustPath("/tmp/proj-c", "session");
    expect(isPathTrusted("/tmp/proj-c")).toBe(true);
    __clearSessionTrustForTests();
    expect(isPathTrusted("/tmp/proj-c")).toBe(false);
  });
});

describe("scope lookup", () => {
  it("returns true for paths under a trusted scope", () => {
    trustPath("/tmp/myroot", "always");
    expect(isPathTrusted("/tmp/myroot/sub/dir/file.ts")).toBe(true);
    expect(isPathTrusted("/tmp/myroot")).toBe(true);
  });

  it("does not match a sibling path that shares a prefix", () => {
    trustPath("/tmp/myroot", "always");
    expect(isPathTrusted("/tmp/myroot-other")).toBe(false);
  });

  it("returns 'always' over 'session' when both match same scope (most-specific wins for nested)", () => {
    trustPath("/tmp/outer", "session");
    trustPath("/tmp/outer/inner", "always");
    expect(getTrustLevel("/tmp/outer/inner/x")).toBe("always");
  });
});

describe("untrustPath", () => {
  it("removes an 'always' entry from disk", () => {
    trustPath("/tmp/proj", "always");
    expect(isPathTrusted("/tmp/proj")).toBe(true);
    untrustPath("/tmp/proj");
    expect(isPathTrusted("/tmp/proj")).toBe(false);
  });

  it("removes a session entry", () => {
    trustPath("/tmp/proj-s", "session");
    expect(isPathTrusted("/tmp/proj-s")).toBe(true);
    untrustPath("/tmp/proj-s");
    expect(isPathTrusted("/tmp/proj-s")).toBe(false);
  });
});

describe("listTrustedPaths", () => {
  it("lists both session and persisted entries, sorted by path", () => {
    trustPath("/tmp/z-proj", "always");
    trustPath("/tmp/a-proj", "session");
    trustPath("/tmp/m-proj", "always");
    const list = listTrustedPaths();
    expect(list.map((e) => e.path)).toEqual([
      "/tmp/a-proj",
      "/tmp/m-proj",
      "/tmp/z-proj",
    ]);
    const aProj = list.find((e) => e.path === "/tmp/a-proj");
    expect(aProj?.level).toBe("session");
  });

  it("returns empty list when nothing is trusted", () => {
    expect(listTrustedPaths()).toEqual([]);
  });
});

describe("persistence reload", () => {
  it("survives across calls (re-reads file)", () => {
    trustPath("/tmp/persist-a", "always");
    __clearSessionTrustForTests();
    expect(isPathTrusted("/tmp/persist-a")).toBe(true);
  });

  it("ignores invalid file content gracefully", () => {
    fs.writeFileSync(trustFile, "not-json", "utf-8");
    expect(isPathTrusted("/tmp/anything")).toBe(false);
    expect(listTrustedPaths()).toEqual([]);
  });

  it("ignores entries with invalid level", () => {
    fs.writeFileSync(
      trustFile,
      JSON.stringify({
        version: 1,
        entries: [{ path: "/tmp/bad", level: "garbage", trustedAt: 1 }],
      }),
      "utf-8",
    );
    expect(isPathTrusted("/tmp/bad")).toBe(false);
  });
});
