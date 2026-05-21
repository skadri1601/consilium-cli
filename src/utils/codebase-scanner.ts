import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeStructure } from "./agents/structure-agent";
import { analyzeArchitecture } from "./agents/architecture-agent";
import { analyzeConfig } from "./agents/config-agent";
import type { FileInfo, ProjectStructure } from "./agents/structure-agent";
import type { ArchitectureInfo } from "./agents/architecture-agent";
import type { ConfigInfo } from "./agents/config-agent";

export type { FileInfo, ProjectStructure } from "./agents/structure-agent";
export type { ArchitectureInfo } from "./agents/architecture-agent";
export type { ConfigInfo } from "./agents/config-agent";

export interface ProjectContext {
  projectType: string;
  language: string;
  framework: string;
  structure: ProjectStructure;
  architecture: ArchitectureInfo;
  config: ConfigInfo;
  fileCount: number;
  totalSize: number;
}

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  "__pycache__",
  ".next",
  ".venv",
  "vendor",
  "build",
]);
const MAX_FILES = 200;
const MAX_FILE_SIZE = 50 * 1024;
const MAX_TOTAL_SIZE = 2 * 1024 * 1024;

const MANIFEST_NAMES = new Set([
  "package.json",
  "Cargo.toml",
  "pyproject.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "setup.py",
  "setup.cfg",
]);

const SOURCE_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".rb",
  ".php",
  ".swift",
  ".kt",
]);
const CONFIG_EXTS = new Set([
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".xml",
  ".env",
  ".conf",
]);
const DOC_EXTS = new Set([".md", ".txt", ".rst"]);

function loadGitignorePatterns(projectPath: string): Set<string> {
  const patterns = new Set<string>();
  try {
    const gitignore = fs.readFileSync(
      path.join(projectPath, ".gitignore"),
      "utf-8",
    );
    for (const line of gitignore.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        patterns.add(trimmed.replace(/\/$/, ""));
      }
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code && code !== "ENOENT") {
      console.warn(`[consilium] could not read .gitignore: ${code}`);
    }
  }
  return patterns;
}

function shouldSkip(name: string, gitignorePatterns: Set<string>): boolean {
  if (SKIP_DIRS.has(name)) return true;
  if (
    name.startsWith(".") &&
    name !== ".github" &&
    name !== ".env.example" &&
    name !== ".env.sample" &&
    name !== ".env.template"
  )
    return true;
  return gitignorePatterns.has(name);
}

function isBinary(buffer: Buffer): boolean {
  return buffer.includes(0);
}

function discoverFiles(projectPath: string): FileInfo[] {
  const gitignorePatterns = loadGitignorePatterns(projectPath);
  const allFiles: FileInfo[] = [];

  function walk(dir: string, depth: number) {
    if (depth > 10) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (shouldSkip(entry.name, gitignorePatterns)) continue;

      const fullPath = path.join(dir, entry.name);
      const relativePath = path
        .relative(projectPath, fullPath)
        .replaceAll("\\", "/");

      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size <= MAX_FILE_SIZE) {
            allFiles.push({ relativePath, size: stat.size });
          }
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code && code !== "ENOENT") {
            console.warn(`[consilium] skipped ${relativePath}: ${code}`);
          }
        }
      }
    }
  }

  walk(projectPath, 0);
  return allFiles;
}

function prioritizeFiles(files: FileInfo[]): FileInfo[] {
  const manifests: FileInfo[] = [];
  const source: FileInfo[] = [];
  const config: FileInfo[] = [];
  const docs: FileInfo[] = [];
  const other: FileInfo[] = [];

  for (const f of files) {
    const basename = path.basename(f.relativePath);
    const ext = path.extname(f.relativePath).toLowerCase();

    if (MANIFEST_NAMES.has(basename)) {
      manifests.push(f);
    } else if (SOURCE_EXTS.has(ext)) {
      source.push(f);
    } else if (
      CONFIG_EXTS.has(ext) ||
      basename.startsWith(".") ||
      basename === "Dockerfile" ||
      basename === "Makefile" ||
      basename === "Jenkinsfile"
    ) {
      config.push(f);
    } else if (DOC_EXTS.has(ext)) {
      docs.push(f);
    } else {
      other.push(f);
    }
  }

  source.sort(
    (a, b) =>
      a.relativePath.split("/").length - b.relativePath.split("/").length,
  );

  const prioritized = [...manifests, ...source, ...config, ...docs, ...other];
  return prioritized.slice(0, MAX_FILES);
}

function readFiles(
  projectPath: string,
  files: FileInfo[],
): {
  manifests: Map<string, string>;
  sourceFiles: Map<string, string>;
  allFiles: Map<string, string>;
} {
  const manifests = new Map<string, string>();
  const sourceFiles = new Map<string, string>();
  const allFiles = new Map<string, string>();
  let totalSize = 0;

  for (const f of files) {
    if (totalSize >= MAX_TOTAL_SIZE) break;

    const fullPath = path.join(projectPath, f.relativePath);
    try {
      const buffer = fs.readFileSync(fullPath);
      if (isBinary(buffer)) continue;

      const content = buffer.toString("utf-8");
      totalSize += buffer.length;

      const basename = path.basename(f.relativePath);
      const ext = path.extname(f.relativePath).toLowerCase();

      allFiles.set(f.relativePath, content);

      if (MANIFEST_NAMES.has(basename)) {
        manifests.set(basename, content);
      }

      if (SOURCE_EXTS.has(ext)) {
        sourceFiles.set(f.relativePath, content);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code && code !== "ENOENT") {
        console.warn(`[consilium] read skipped ${f.relativePath}: ${code}`);
      }
    }
  }

  return { manifests, sourceFiles, allFiles };
}

export async function scanCodebase(
  projectPath: string,
): Promise<ProjectContext> {
  const discovered = discoverFiles(projectPath);
  const prioritized = prioritizeFiles(discovered);
  const { manifests, sourceFiles, allFiles } = readFiles(
    projectPath,
    prioritized,
  );
  const fileList = prioritized.map((f) => f.relativePath);

  const [structure, architecture, config] = await Promise.all([
    Promise.resolve(analyzeStructure(prioritized, manifests)),
    Promise.resolve(analyzeArchitecture(sourceFiles)),
    Promise.resolve(analyzeConfig(allFiles, fileList)),
  ]);

  const totalSize = prioritized.reduce((sum, f) => sum + f.size, 0);

  return {
    projectType: structure.projectType,
    language: structure.language,
    framework: structure.framework,
    structure,
    architecture,
    config,
    fileCount: discovered.length,
    totalSize,
  };
}

export function formatProjectContext(ctx: ProjectContext): string {
  const lines: string[] = [];

  lines.push(
    `Project: ${ctx.projectType} (${ctx.language})`,
    `Framework: ${ctx.framework}`,
    `Files: ${ctx.fileCount} | Size: ${(ctx.totalSize / 1024).toFixed(1)}KB`,
  );

  if (ctx.structure.entryPoints.length > 0) {
    lines.push(`Entry points: ${ctx.structure.entryPoints.join(", ")}`);
  }

  if (ctx.structure.directories.length > 0) {
    lines.push(`Top dirs: ${ctx.structure.directories.join(", ")}`);
  }

  if (ctx.architecture.patterns.length > 0) {
    lines.push(`Patterns: ${ctx.architecture.patterns.join(", ")}`);
  }

  if (ctx.architecture.dataFlow.length > 0) {
    lines.push(`Data flow: ${ctx.architecture.dataFlow.join(", ")}`);
  }

  if (ctx.config.buildSystem !== "unknown") {
    lines.push(`Build: ${ctx.config.buildSystem}`);
  }

  if (ctx.config.testFramework !== "unknown") {
    lines.push(`Tests: ${ctx.config.testFramework}`);
  }

  if (ctx.config.hasDocker) lines.push("Docker: yes");
  if (ctx.config.hasCI) lines.push("CI: yes");

  if (ctx.config.envVars.length > 0) {
    lines.push(`Env vars: ${ctx.config.envVars.slice(0, 10).join(", ")}`);
  }

  return lines.join("\n");
}
