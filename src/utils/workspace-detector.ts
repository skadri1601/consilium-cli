import fs from "node:fs";
import path from "node:path";

export interface WorkspaceInfo {
  projectType: string;
  language: string;
  framework: string;
  packageManager: string;
  keyFiles: string[];
  hasTests: boolean;
  hasDocker: boolean;
  hasCI: boolean;
}

const KEY_FILE_CANDIDATES = [
  "tsconfig.json",
  ".env",
  "Dockerfile",
  "docker-compose.yml",
  "jest.config.js",
  "jest.config.ts",
  "vitest.config.js",
  "vitest.config.ts",
  "pytest.ini",
  ".eslintrc.json",
  ".eslintrc.js",
  ".prettierrc",
];

function emptyWorkspaceInfo(): WorkspaceInfo {
  return {
    projectType: "unknown",
    language: "unknown",
    framework: "none",
    packageManager: "unknown",
    keyFiles: [],
    hasTests: false,
    hasDocker: false,
    hasCI: false,
  };
}

function applyNodeProject(root: string, info: WorkspaceInfo): void {
  info.projectType = "node";
  info.language = "javascript";
  if (fileExists(root, "tsconfig.json")) {
    info.language = "typescript";
  }
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf-8"),
    );
    const allDeps: Record<string, unknown> = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
    if (allDeps.next) info.framework = "next";
    else if (allDeps.express) info.framework = "express";
    else if (allDeps.react) info.framework = "react";
    else if (allDeps.vue) info.framework = "vue";
    else if (allDeps["@angular/core"]) info.framework = "angular";
    else if (allDeps["@nestjs/core"]) info.framework = "nestjs";
  } catch {
    return;
  }
}

function inferPythonFramework(root: string, fileName: string): string {
  try {
    const content = fs.readFileSync(path.join(root, fileName), "utf-8");
    if (content.includes("django")) return "django";
    if (content.includes("flask")) return "flask";
    if (content.includes("fastapi")) return "fastapi";
    return "none";
  } catch {
    return "none";
  }
}

function applyPythonProject(root: string, info: WorkspaceInfo): void {
  info.projectType = "python";
  info.language = "python";
  if (fileExists(root, "pyproject.toml")) {
    const fw = inferPythonFramework(root, "pyproject.toml");
    if (fw !== "none") info.framework = fw;
  }
  if (info.framework === "none" && fileExists(root, "requirements.txt")) {
    const fw = inferPythonFramework(root, "requirements.txt");
    if (fw !== "none") info.framework = fw;
  }
}

function applyProjectKind(root: string, info: WorkspaceInfo): void {
  if (fileExists(root, "package.json")) {
    applyNodeProject(root, info);
    return;
  }
  if (
    fileExists(root, "pyproject.toml") ||
    fileExists(root, "requirements.txt")
  ) {
    applyPythonProject(root, info);
    return;
  }
  if (fileExists(root, "Cargo.toml")) {
    info.projectType = "rust";
    info.language = "rust";
    return;
  }
  if (fileExists(root, "go.mod")) {
    info.projectType = "go";
    info.language = "go";
    return;
  }
  if (fileExists(root, "pom.xml") || fileExists(root, "build.gradle")) {
    info.projectType = "java";
    info.language = "java";
  }
}

function applyPackageManager(root: string, info: WorkspaceInfo): void {
  if (fileExists(root, "pnpm-lock.yaml")) info.packageManager = "pnpm";
  else if (fileExists(root, "yarn.lock")) info.packageManager = "yarn";
  else if (fileExists(root, "package-lock.json")) info.packageManager = "npm";
  else if (fileExists(root, "poetry.lock")) info.packageManager = "poetry";
  else if (fileExists(root, "Pipfile.lock")) info.packageManager = "pipenv";
}

function collectKeyFileList(root: string, info: WorkspaceInfo): void {
  for (const candidate of KEY_FILE_CANDIDATES) {
    if (fileExists(root, candidate)) {
      info.keyFiles.push(candidate);
    }
  }
}

function applyWorkspaceFlags(root: string, info: WorkspaceInfo): void {
  info.hasTests =
    fileExists(root, "jest.config.js") ||
    fileExists(root, "jest.config.ts") ||
    fileExists(root, "vitest.config.js") ||
    fileExists(root, "vitest.config.ts") ||
    fileExists(root, "pytest.ini") ||
    dirExists(root, "__tests__") ||
    dirExists(root, "tests") ||
    dirExists(root, "test");

  info.hasDocker =
    fileExists(root, "Dockerfile") || fileExists(root, "docker-compose.yml");

  info.hasCI =
    dirExists(root, ".github/workflows") ||
    fileExists(root, ".gitlab-ci.yml") ||
    dirExists(root, ".circleci");
}

export function detectWorkspace(dir?: string): WorkspaceInfo {
  const root = dir || process.cwd();
  const info = emptyWorkspaceInfo();
  applyProjectKind(root, info);
  applyPackageManager(root, info);
  collectKeyFileList(root, info);
  applyWorkspaceFlags(root, info);
  return info;
}

export function getAutoLoadFiles(info: WorkspaceInfo, dir?: string): string[] {
  const root = dir || process.cwd();
  const files: string[] = [];

  switch (info.projectType) {
    case "node":
      if (fileExists(root, "package.json"))
        files.push(path.join(root, "package.json"));
      if (fileExists(root, "tsconfig.json"))
        files.push(path.join(root, "tsconfig.json"));
      break;
    case "python":
      if (fileExists(root, "pyproject.toml"))
        files.push(path.join(root, "pyproject.toml"));
      else if (fileExists(root, "requirements.txt"))
        files.push(path.join(root, "requirements.txt"));
      break;
    case "rust":
      if (fileExists(root, "Cargo.toml"))
        files.push(path.join(root, "Cargo.toml"));
      break;
    case "go":
      if (fileExists(root, "go.mod")) files.push(path.join(root, "go.mod"));
      break;
  }

  const readmePath = path.join(root, "README.md");
  if (fs.existsSync(readmePath)) {
    files.push(readmePath);
  }

  return files;
}

export function formatWorkspaceInfo(info: WorkspaceInfo): string {
  const lines: string[] = [];
  lines.push(`Project: ${info.projectType} (${info.language})`);
  if (info.framework !== "none") lines.push(`Framework: ${info.framework}`);
  if (info.packageManager !== "unknown")
    lines.push(`Package Manager: ${info.packageManager}`);
  if (info.keyFiles.length > 0)
    lines.push(`Key Files: ${info.keyFiles.join(", ")}`);
  lines.push(
    `Tests: ${info.hasTests ? "yes" : "no"}`,
    `Docker: ${info.hasDocker ? "yes" : "no"}`,
    `CI: ${info.hasCI ? "yes" : "no"}`,
  );
  return lines.join("\n");
}

function fileExists(root: string, relative: string): boolean {
  try {
    return fs.statSync(path.join(root, relative)).isFile();
  } catch {
    return false;
  }
}

function dirExists(root: string, relative: string): boolean {
  try {
    return fs.statSync(path.join(root, relative)).isDirectory();
  } catch {
    return false;
  }
}
