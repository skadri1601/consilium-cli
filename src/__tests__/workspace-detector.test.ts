import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { detectWorkspace } from "../utils/workspace-detector";
import { resolveProjectRoot } from "../utils/project-root";

let tmpDir: string;

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "consilium-ws-test-"));
}

function writeFile(dir: string, relative: string, content: string) {
  const fullPath = path.join(dir, relative);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf-8");
}

function makeDir(dir: string, relative: string) {
  fs.mkdirSync(path.join(dir, relative), { recursive: true });
}

beforeEach(() => {
  tmpDir = createTmpDir();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("resolveProjectRoot", () => {
  it("returns cwd and marks isGitRepo=false for non-git dir", () => {
    const result = resolveProjectRoot(tmpDir);
    expect(result.cwd).toBe(path.resolve(tmpDir));
    expect(result.isGitRepo).toBe(false);
    expect(result.root).toBe(path.resolve(tmpDir));
    expect(result.isSubdirectory).toBe(false);
  });

  it("finds git repo root and sets isGitRepo=true", () => {
    execSync("git init", { cwd: tmpDir, stdio: "ignore" });
    const sub = path.join(tmpDir, "src", "lib");
    fs.mkdirSync(sub, { recursive: true });
    const result = resolveProjectRoot(sub);
    expect(result.isGitRepo).toBe(true);
    expect(result.root).toBe(path.resolve(tmpDir));
    expect(result.isSubdirectory).toBe(true);
  });

  it("root equals cwd when cwd is the git root", () => {
    execSync("git init", { cwd: tmpDir, stdio: "ignore" });
    const result = resolveProjectRoot(tmpDir);
    expect(result.isGitRepo).toBe(true);
    expect(result.isSubdirectory).toBe(false);
    expect(result.root).toBe(result.cwd);
  });
});

describe("detectWorkspace", () => {
  describe("language detection", () => {
    it("detects node/javascript from package.json", () => {
      writeFile(tmpDir, "package.json", JSON.stringify({ name: "test" }));
      const info = detectWorkspace(tmpDir);
      expect(info.projectType).toBe("node");
      expect(info.language).toBe("javascript");
    });

    it("detects node/typescript when tsconfig.json exists", () => {
      writeFile(tmpDir, "package.json", JSON.stringify({ name: "test" }));
      writeFile(tmpDir, "tsconfig.json", "{}");
      const info = detectWorkspace(tmpDir);
      expect(info.projectType).toBe("node");
      expect(info.language).toBe("typescript");
    });

    it("detects rust from Cargo.toml", () => {
      writeFile(tmpDir, "Cargo.toml", '[package]\nname = "test"');
      const info = detectWorkspace(tmpDir);
      expect(info.projectType).toBe("rust");
      expect(info.language).toBe("rust");
    });

    it("detects python from pyproject.toml", () => {
      writeFile(tmpDir, "pyproject.toml", '[project]\nname = "test"');
      const info = detectWorkspace(tmpDir);
      expect(info.projectType).toBe("python");
      expect(info.language).toBe("python");
    });

    it("detects go from go.mod", () => {
      writeFile(tmpDir, "go.mod", "module example.com/test");
      const info = detectWorkspace(tmpDir);
      expect(info.projectType).toBe("go");
      expect(info.language).toBe("go");
    });

    it("detects java from pom.xml", () => {
      writeFile(tmpDir, "pom.xml", "<project></project>");
      const info = detectWorkspace(tmpDir);
      expect(info.projectType).toBe("java");
      expect(info.language).toBe("java");
    });

    it("returns unknown for empty directory", () => {
      const info = detectWorkspace(tmpDir);
      expect(info.projectType).toBe("unknown");
      expect(info.language).toBe("unknown");
    });
  });

  describe("framework detection", () => {
    it("detects next.js", () => {
      writeFile(
        tmpDir,
        "package.json",
        JSON.stringify({
          name: "test",
          dependencies: { next: "^14.0.0", react: "^18.0.0" },
        }),
      );
      const info = detectWorkspace(tmpDir);
      expect(info.framework).toBe("next");
    });

    it("detects express", () => {
      writeFile(
        tmpDir,
        "package.json",
        JSON.stringify({
          name: "test",
          dependencies: { express: "^4.0.0" },
        }),
      );
      const info = detectWorkspace(tmpDir);
      expect(info.framework).toBe("express");
    });

    it("detects react (without next)", () => {
      writeFile(
        tmpDir,
        "package.json",
        JSON.stringify({
          name: "test",
          dependencies: { react: "^18.0.0" },
        }),
      );
      const info = detectWorkspace(tmpDir);
      expect(info.framework).toBe("react");
    });

    it("detects vue", () => {
      writeFile(
        tmpDir,
        "package.json",
        JSON.stringify({
          name: "test",
          dependencies: { vue: "^3.0.0" },
        }),
      );
      const info = detectWorkspace(tmpDir);
      expect(info.framework).toBe("vue");
    });

    it("detects angular", () => {
      writeFile(
        tmpDir,
        "package.json",
        JSON.stringify({
          name: "test",
          dependencies: { "@angular/core": "^17.0.0" },
        }),
      );
      const info = detectWorkspace(tmpDir);
      expect(info.framework).toBe("angular");
    });

    it("detects nestjs", () => {
      writeFile(
        tmpDir,
        "package.json",
        JSON.stringify({
          name: "test",
          dependencies: { "@nestjs/core": "^10.0.0" },
        }),
      );
      const info = detectWorkspace(tmpDir);
      expect(info.framework).toBe("nestjs");
    });

    it("detects fastapi from pyproject.toml", () => {
      writeFile(
        tmpDir,
        "pyproject.toml",
        '[project]\ndependencies = ["fastapi"]',
      );
      const info = detectWorkspace(tmpDir);
      expect(info.framework).toBe("fastapi");
    });

    it("detects django from requirements.txt", () => {
      writeFile(tmpDir, "requirements.txt", "django==4.2\ncelery==5.3");
      const info = detectWorkspace(tmpDir);
      expect(info.framework).toBe("django");
    });

    it("returns none when no framework detected", () => {
      writeFile(tmpDir, "package.json", JSON.stringify({ name: "test" }));
      const info = detectWorkspace(tmpDir);
      expect(info.framework).toBe("none");
    });
  });

  describe("package manager detection", () => {
    it("detects pnpm", () => {
      writeFile(tmpDir, "package.json", JSON.stringify({ name: "test" }));
      writeFile(tmpDir, "pnpm-lock.yaml", "");
      const info = detectWorkspace(tmpDir);
      expect(info.packageManager).toBe("pnpm");
    });

    it("detects yarn", () => {
      writeFile(tmpDir, "package.json", JSON.stringify({ name: "test" }));
      writeFile(tmpDir, "yarn.lock", "");
      const info = detectWorkspace(tmpDir);
      expect(info.packageManager).toBe("yarn");
    });

    it("detects npm", () => {
      writeFile(tmpDir, "package.json", JSON.stringify({ name: "test" }));
      writeFile(tmpDir, "package-lock.json", "{}");
      const info = detectWorkspace(tmpDir);
      expect(info.packageManager).toBe("npm");
    });

    it("detects poetry", () => {
      writeFile(tmpDir, "pyproject.toml", '[project]\nname = "test"');
      writeFile(tmpDir, "poetry.lock", "");
      const info = detectWorkspace(tmpDir);
      expect(info.packageManager).toBe("poetry");
    });

    it("detects pipenv", () => {
      writeFile(tmpDir, "pyproject.toml", '[project]\nname = "test"');
      writeFile(tmpDir, "Pipfile.lock", "{}");
      const info = detectWorkspace(tmpDir);
      expect(info.packageManager).toBe("pipenv");
    });

    it("returns unknown when no lock file found", () => {
      writeFile(tmpDir, "package.json", JSON.stringify({ name: "test" }));
      const info = detectWorkspace(tmpDir);
      expect(info.packageManager).toBe("unknown");
    });
  });

  describe("test suite detection", () => {
    it("detects tests from vitest.config.ts", () => {
      writeFile(tmpDir, "package.json", JSON.stringify({ name: "test" }));
      writeFile(tmpDir, "vitest.config.ts", "export default {}");
      const info = detectWorkspace(tmpDir);
      expect(info.hasTests).toBe(true);
    });

    it("detects tests from jest.config.js", () => {
      writeFile(tmpDir, "package.json", JSON.stringify({ name: "test" }));
      writeFile(tmpDir, "jest.config.js", "module.exports = {}");
      const info = detectWorkspace(tmpDir);
      expect(info.hasTests).toBe(true);
    });

    it("detects tests from pytest.ini", () => {
      writeFile(tmpDir, "pyproject.toml", '[project]\nname = "test"');
      writeFile(tmpDir, "pytest.ini", "[pytest]");
      const info = detectWorkspace(tmpDir);
      expect(info.hasTests).toBe(true);
    });

    it("detects tests from __tests__ directory", () => {
      writeFile(tmpDir, "package.json", JSON.stringify({ name: "test" }));
      makeDir(tmpDir, "__tests__");
      const info = detectWorkspace(tmpDir);
      expect(info.hasTests).toBe(true);
    });

    it("detects tests from tests directory", () => {
      writeFile(tmpDir, "package.json", JSON.stringify({ name: "test" }));
      makeDir(tmpDir, "tests");
      const info = detectWorkspace(tmpDir);
      expect(info.hasTests).toBe(true);
    });

    it("returns hasTests=false when no test indicators", () => {
      writeFile(tmpDir, "package.json", JSON.stringify({ name: "test" }));
      const info = detectWorkspace(tmpDir);
      expect(info.hasTests).toBe(false);
    });
  });

  describe("docker and CI detection", () => {
    it("detects Docker from Dockerfile", () => {
      writeFile(tmpDir, "package.json", JSON.stringify({ name: "test" }));
      writeFile(tmpDir, "Dockerfile", "FROM node:20");
      const info = detectWorkspace(tmpDir);
      expect(info.hasDocker).toBe(true);
    });

    it("detects Docker from docker-compose.yml", () => {
      writeFile(tmpDir, "package.json", JSON.stringify({ name: "test" }));
      writeFile(tmpDir, "docker-compose.yml", 'version: "3"');
      const info = detectWorkspace(tmpDir);
      expect(info.hasDocker).toBe(true);
    });

    it("detects CI from .github/workflows", () => {
      writeFile(tmpDir, "package.json", JSON.stringify({ name: "test" }));
      makeDir(tmpDir, ".github/workflows");
      const info = detectWorkspace(tmpDir);
      expect(info.hasCI).toBe(true);
    });

    it("detects CI from .gitlab-ci.yml", () => {
      writeFile(tmpDir, "package.json", JSON.stringify({ name: "test" }));
      writeFile(tmpDir, ".gitlab-ci.yml", "stages: [build]");
      const info = detectWorkspace(tmpDir);
      expect(info.hasCI).toBe(true);
    });
  });

  describe("key files collection", () => {
    it("collects key files that exist", () => {
      writeFile(tmpDir, "package.json", JSON.stringify({ name: "test" }));
      writeFile(tmpDir, "tsconfig.json", "{}");
      writeFile(tmpDir, "Dockerfile", "FROM node:20");
      writeFile(tmpDir, ".eslintrc.json", "{}");
      const info = detectWorkspace(tmpDir);
      expect(info.keyFiles).toContain("tsconfig.json");
      expect(info.keyFiles).toContain("Dockerfile");
      expect(info.keyFiles).toContain(".eslintrc.json");
    });

    it("returns empty keyFiles for bare directory", () => {
      const info = detectWorkspace(tmpDir);
      expect(info.keyFiles).toEqual([]);
    });
  });
});
