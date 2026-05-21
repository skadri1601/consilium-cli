import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanProject } from "./project-scanner";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "consilium-scan-test-"));
}

describe("scanProject", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("scans nested directories and excludes secrets", () => {
    const root = makeTempDir();
    dirs.push(root);
    fs.mkdirSync(path.join(root, "apps", "web", "src"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "apps", "web", "src", "index.ts"),
      "export const ok = true;\n",
      "utf-8",
    );
    fs.writeFileSync(path.join(root, ".env"), "SECRET=123\n", "utf-8");

    const result = scanProject(root, {
      maxFiles: 50,
      maxTotalBytes: 1024 * 1024,
      maxDepth: 10,
    });
    expect(result.files.some((f) => f.path === "apps/web/src/index.ts")).toBe(
      true,
    );
    expect(result.files.some((f) => f.path === ".env")).toBe(false);
    expect(result.manifest.skipped.secret).toBeGreaterThanOrEqual(1);
  });
});
