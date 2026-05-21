import * as path from "node:path";

export interface ProjectStructure {
  projectType: string;
  language: string;
  framework: string;
  entryPoints: string[];
  directories: string[];
  manifestFiles: string[];
}

export interface FileInfo {
  relativePath: string;
  content?: string;
  size: number;
}

const FRAMEWORK_DETECTORS: Record<
  string,
  (deps: Record<string, string>) => string
> = {
  node: (deps) => {
    if (deps["next"]) return "nextjs";
    if (deps["express"]) return "express";
    if (deps["@nestjs/core"]) return "nestjs";
    if (deps["fastify"]) return "fastify";
    if (deps["koa"]) return "koa";
    if (deps["react"]) return "react";
    if (deps["vue"]) return "vue";
    if (deps["@angular/core"]) return "angular";
    if (deps["svelte"]) return "svelte";
    return "node";
  },
  python: (deps) => {
    if (deps["django"] || deps["Django"]) return "django";
    if (deps["flask"] || deps["Flask"]) return "flask";
    if (deps["fastapi"]) return "fastapi";
    if (deps["starlette"]) return "starlette";
    return "python";
  },
};

function detectNodeFramework(manifest: string): {
  framework: string;
  language: string;
} {
  try {
    const pkg = JSON.parse(manifest);
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const nodeDetect = FRAMEWORK_DETECTORS.node;
    const framework = nodeDetect ? nodeDetect(allDeps) : "node";
    const language =
      allDeps["typescript"] || allDeps["ts-node"] ? "typescript" : "javascript";
    return { framework, language };
  } catch {
    return { framework: "node", language: "javascript" };
  }
}

function detectPythonFramework(manifest: string): string {
  const lower = manifest.toLowerCase();
  if (lower.includes("django")) return "django";
  if (lower.includes("flask")) return "flask";
  if (lower.includes("fastapi")) return "fastapi";
  if (lower.includes("starlette")) return "starlette";
  return "python";
}

const NODE_ENTRY_CANDIDATES = [
  "index.ts",
  "index.js",
  "src/index.ts",
  "src/index.js",
  "src/main.ts",
  "src/main.js",
  "app.ts",
  "app.js",
  "server.ts",
  "server.js",
];
const PYTHON_ENTRY_CANDIDATES = [
  "main.py",
  "app.py",
  "manage.py",
  "src/main.py",
  "wsgi.py",
  "asgi.py",
];
const RUST_ENTRY_CANDIDATES = ["src/main.rs", "src/lib.rs"];

function collectNodeEntries(names: string[]): string[] {
  return NODE_ENTRY_CANDIDATES.filter((n) => names.includes(n));
}

function collectPythonEntries(names: string[]): string[] {
  return PYTHON_ENTRY_CANDIDATES.filter((n) => names.includes(n));
}

function collectRustEntries(names: string[]): string[] {
  return RUST_ENTRY_CANDIDATES.filter((n) => names.includes(n));
}

function collectGoEntries(names: string[]): string[] {
  return names.filter((n) => n === "main.go" || n.endsWith("/main.go"));
}

function collectJavaEntries(names: string[]): string[] {
  return names.filter(
    (n) =>
      n.endsWith("Application.java") ||
      n.endsWith("/Application.java") ||
      n.endsWith("Main.java") ||
      n.endsWith("/Main.java"),
  );
}

function findEntryPoints(files: FileInfo[], projectType: string): string[] {
  const names = files.map((f) => f.relativePath);
  if (projectType === "node") return collectNodeEntries(names);
  if (projectType === "python") return collectPythonEntries(names);
  if (projectType === "rust") return collectRustEntries(names);
  if (projectType === "go") return collectGoEntries(names);
  if (projectType === "java") return collectJavaEntries(names);
  return [];
}

function extractDirectories(files: FileInfo[]): string[] {
  const dirs = new Set<string>();
  for (const f of files) {
    const dir = path.dirname(f.relativePath);
    if (dir && dir !== ".") {
      const root = dir.split(path.sep)[0];
      if (root) dirs.add(root);
    }
  }
  return Array.from(dirs).sort((a, b) => a.localeCompare(b));
}

interface ManifestMeta {
  projectType: string;
  language: string;
  framework: string;
}

function resolveFromManifests(manifests: Map<string, string>): ManifestMeta {
  if (manifests.has("package.json")) {
    const result = detectNodeFramework(manifests.get("package.json") ?? "{}");
    return {
      projectType: "node",
      language: result.language,
      framework: result.framework,
    };
  }
  if (manifests.has("pyproject.toml") || manifests.has("setup.py")) {
    const content =
      manifests.get("pyproject.toml") || manifests.get("setup.py") || "";
    return {
      projectType: "python",
      language: "python",
      framework: detectPythonFramework(content),
    };
  }
  if (manifests.has("Cargo.toml")) {
    return { projectType: "rust", language: "rust", framework: "rust" };
  }
  if (manifests.has("go.mod")) {
    return { projectType: "go", language: "go", framework: "go" };
  }
  if (manifests.has("pom.xml") || manifests.has("build.gradle")) {
    return {
      projectType: "java",
      language: "java",
      framework: manifests.has("pom.xml") ? "maven" : "gradle",
    };
  }
  return { projectType: "unknown", language: "unknown", framework: "unknown" };
}

export function analyzeStructure(
  files: FileInfo[],
  manifests: Map<string, string>,
): ProjectStructure {
  const meta = resolveFromManifests(manifests);
  const manifestFiles = Array.from(manifests.keys());

  return {
    projectType: meta.projectType,
    language: meta.language,
    framework: meta.framework,
    entryPoints: findEntryPoints(files, meta.projectType),
    directories: extractDirectories(files),
    manifestFiles,
  };
}
