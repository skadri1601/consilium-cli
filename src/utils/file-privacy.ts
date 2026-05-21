import * as fs from "node:fs";
import * as path from "node:path";

export type FileClassification =
  | "source"
  | "manifest"
  | "config"
  | "doc"
  | "secret"
  | "skip"
  | "dependency";

export const SECRET_PATTERNS: string[] = [
  ".env*",
  "*.key",
  "*.pem",
  "*.p12",
  "credentials*",
  "secret*",
  "*token*",
  ".npmrc",
  ".pypirc",
  "serviceAccountKey.json",
];

export const SKIP_DIRS: string[] = [
  "node_modules",
  ".venv",
  "vendor",
  "target",
  "dist",
  "build",
  ".next",
];

export const READABLE_EXTENSIONS: Set<string> = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".css",
  ".html",
  ".sql",
  ".yaml",
  ".yml",
  ".json",
  ".md",
  ".prisma",
]);

const SKIP_EXTENSIONS: Set<string> = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".svg",
  ".webp",
  ".pdf",
  ".docx",
  ".doc",
  ".xlsx",
  ".xls",
  ".pptx",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".o",
  ".obj",
  ".mp3",
  ".mp4",
  ".wav",
  ".avi",
  ".mov",
  ".mkv",
  ".flac",
  ".ogg",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".rar",
  ".7z",
  ".tgz",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".map",
  ".lock",
]);

const MANIFEST_NAMES: Set<string> = new Set([
  "package.json",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "pom.xml",
  "build.gradle",
  "setup.py",
  "setup.cfg",
  "Gemfile",
  "composer.json",
]);

const SPECIAL_READABLE: Set<string> = new Set(["Dockerfile", "Makefile"]);

export const PRIVACY_PREAMBLE = `PRIVACY RULES: You will NEVER receive .env, .key, .pem, or credential files.
Do NOT ask for, infer, or generate secret values.
Output must contain ZERO secret values.`;

function globMatch(pattern: string, filename: string): boolean {
  let regex = "^";
  for (const c of pattern) {
    if (c === "*") {
      regex += ".*";
    } else if (c === "?") {
      regex += ".";
    } else if (c === ".") {
      regex += String.raw`\.`;
    } else {
      regex += c;
    }
  }
  regex += "$";
  return new RegExp(regex, "i").test(filename);
}

export function isSecretFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  return SECRET_PATTERNS.some((pattern) => globMatch(pattern, basename));
}

export function isDependencyDir(dirPath: string): boolean {
  const dirname = path.basename(dirPath);
  return SKIP_DIRS.includes(dirname);
}

export function classifyFile(filePath: string): FileClassification {
  const basename = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  if (isSecretFile(filePath)) return "secret";

  const segments = filePath.replaceAll("\\", "/").split("/");
  for (const seg of segments) {
    if (SKIP_DIRS.includes(seg)) return "dependency";
  }

  if (SKIP_EXTENSIONS.has(ext)) return "skip";
  if (
    basename === "package-lock.json" ||
    basename === "yarn.lock" ||
    basename === "pnpm-lock.yaml"
  )
    return "skip";

  if (MANIFEST_NAMES.has(basename)) return "manifest";
  if (SPECIAL_READABLE.has(basename)) return "config";

  if (ext === ".md" || ext === ".txt" || ext === ".rst") return "doc";

  if (
    ext === ".json" ||
    ext === ".yaml" ||
    ext === ".yml" ||
    ext === ".toml" ||
    ext === ".ini" ||
    ext === ".cfg" ||
    ext === ".xml" ||
    ext === ".conf"
  )
    return "config";

  if (READABLE_EXTENSIONS.has(ext)) return "source";

  return "skip";
}

export function isReadableSource(filePath: string): boolean {
  const classification = classifyFile(filePath);
  return (
    classification === "source" ||
    classification === "config" ||
    classification === "manifest" ||
    classification === "doc"
  );
}

export function sanitizeDockerCompose(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let skipBlock = false;
  let skipIndent = 0;

  for (const line of lines) {
    const trimmed = line.trimStart();
    const currentIndent = line.length - trimmed.length;

    if (skipBlock) {
      if (trimmed === "" || currentIndent > skipIndent) {
        continue;
      }
      skipBlock = false;
    }

    if (/^(environment|env_file|secrets)\s*:/.test(trimmed)) {
      skipBlock = true;
      skipIndent = currentIndent;
      continue;
    }

    result.push(line);
  }

  return result.join("\n");
}

export interface ScanResult {
  readableFiles: Array<{ path: string; classification: FileClassification }>;
  secretFiles: string[];
  skippedFiles: string[];
  totalSize: number;
}

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
        patterns.add(trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed);
      }
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code && code !== "ENOENT") {
      console.warn(`[consilium] .gitignore read skipped: ${code}`);
    }
  }
  return patterns;
}

export function scanDirectory(
  dir: string,
  options?: { maxFiles?: number; maxFileSize?: number; maxTotalSize?: number },
): ScanResult {
  const maxFiles = options?.maxFiles ?? 200;
  const maxFileSize = options?.maxFileSize ?? 50 * 1024;
  const maxTotalSize = options?.maxTotalSize ?? 2 * 1024 * 1024;

  const gitignorePatterns = loadGitignorePatterns(dir);

  const result: ScanResult = {
    readableFiles: [],
    secretFiles: [],
    skippedFiles: [],
    totalSize: 0,
  };

  walkScanTree(dir, 0, {
    rootDir: dir,
    maxFiles,
    maxFileSize,
    maxTotalSize,
    gitignorePatterns,
    result,
  });
  return result;
}

interface ScanWalkState {
  rootDir: string;
  maxFiles: number;
  maxFileSize: number;
  maxTotalSize: number;
  gitignorePatterns: Set<string>;
  result: ScanResult;
}

function tryReadScanDir(currentDir: string): fs.Dirent[] | undefined {
  try {
    return fs.readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return undefined;
  }
}

function handleScanFileEntry(
  fullPath: string,
  relativePath: string,
  state: ScanWalkState,
): void {
  const classification = classifyFile(relativePath);
  if (classification === "secret") {
    state.result.secretFiles.push(relativePath);
    return;
  }
  if (classification === "skip" || classification === "dependency") {
    state.result.skippedFiles.push(relativePath);
    return;
  }
  try {
    const stat = fs.statSync(fullPath);
    if (stat.size > state.maxFileSize) {
      state.result.skippedFiles.push(relativePath);
      return;
    }
    if (state.result.totalSize + stat.size > state.maxTotalSize) {
      state.result.skippedFiles.push(relativePath);
      return;
    }
    state.result.totalSize += stat.size;
    state.result.readableFiles.push({ path: relativePath, classification });
  } catch {
    state.result.skippedFiles.push(relativePath);
  }
}

function processScanDirectoryEntry(
  entry: fs.Dirent,
  currentDir: string,
  depth: number,
  state: ScanWalkState,
): void {
  const fullPath = path.join(currentDir, entry.name);
  const relativePath = path
    .relative(state.rootDir, fullPath)
    .replaceAll("\\", "/");

  if (entry.isDirectory()) {
    if (isDependencyDir(fullPath)) return;
    if (entry.name.startsWith(".") && entry.name !== ".github") return;
    if (state.gitignorePatterns.has(entry.name)) return;
    walkScanTree(fullPath, depth + 1, state);
    return;
  }

  if (!entry.isFile()) return;
  handleScanFileEntry(fullPath, relativePath, state);
}

function walkScanTree(
  currentDir: string,
  depth: number,
  state: ScanWalkState,
): void {
  if (depth > 10) return;
  if (state.result.readableFiles.length >= state.maxFiles) return;

  const entries = tryReadScanDir(currentDir);
  if (!entries) return;

  for (const entry of entries) {
    if (state.result.readableFiles.length >= state.maxFiles) return;
    processScanDirectoryEntry(entry, currentDir, depth, state);
  }
}
