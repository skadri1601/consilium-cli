import fs from "node:fs";
import path from "node:path";
import { classifyFile, type FileClassification } from "./file-privacy";

export interface ScannedFile {
  path: string;
  content: string;
  category: "manifest" | "source" | "config" | "doc";
}

const SKIP_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "__pycache__",
  ".venv",
  "vendor",
  "target",
]);

const DEFAULT_MAX_FILES = Number(
  process.env.CONSILIUM_CONTEXT_MAX_FILES || 500,
);
const DEFAULT_MAX_BYTES = Number(
  process.env.CONSILIUM_CONTEXT_MAX_BYTES || 2 * 1024 * 1024,
);
const DEFAULT_MAX_DEPTH = Number(process.env.CONSILIUM_CONTEXT_MAX_DEPTH || 12);

type SkipReason =
  | "secret"
  | "binary"
  | "skip-rule"
  | "payload-limit"
  | "read-error"
  | "max-files";

export interface ScanManifest {
  root: string;
  loaded: number;
  loadedBytes: number;
  skipped: Record<SkipReason, number>;
  loadedPaths: string[];
}

export interface ProjectScanResult {
  files: ScannedFile[];
  summary: string;
  manifest: ScanManifest;
}

interface ScanOptions {
  maxFiles?: number;
  maxTotalBytes?: number;
  maxDepth?: number;
}

function classificationToCategory(
  classification: FileClassification,
): ScannedFile["category"] | null {
  if (classification === "manifest") return "manifest";
  if (classification === "source") return "source";
  if (classification === "config") return "config";
  if (classification === "doc") return "doc";
  return null;
}

function createManifest(root: string): ScanManifest {
  return {
    root,
    loaded: 0,
    loadedBytes: 0,
    skipped: {
      secret: 0,
      binary: 0,
      "skip-rule": 0,
      "payload-limit": 0,
      "read-error": 0,
      "max-files": 0,
    },
    loadedPaths: [],
  };
}

function listSortedEntries(dir: string): fs.Dirent[] {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    return entries;
  } catch {
    return [];
  }
}

function walkAndCollect(
  root: string,
  currentDir: string,
  depth: number,
  files: ScannedFile[],
  manifest: ScanManifest,
  options: Required<ScanOptions>,
): void {
  if (depth > options.maxDepth) return;
  const entries = listSortedEntries(currentDir);
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    const relativePath = path.relative(root, fullPath).replaceAll("\\", "/");

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".") && entry.name !== ".github") continue;
      walkAndCollect(root, fullPath, depth + 1, files, manifest, options);
      continue;
    }
    if (!entry.isFile()) continue;

    if (files.length >= options.maxFiles) {
      manifest.skipped["max-files"] += 1;
      continue;
    }

    const classification = classifyFile(relativePath);
    if (classification === "secret") {
      manifest.skipped.secret += 1;
      continue;
    }
    if (classification === "dependency" || classification === "skip") {
      const ext = path.extname(relativePath).toLowerCase();
      if (
        ext &&
        [
          ".png",
          ".jpg",
          ".jpeg",
          ".gif",
          ".pdf",
          ".zip",
          ".mp4",
          ".woff",
          ".woff2",
        ].includes(ext)
      ) {
        manifest.skipped.binary += 1;
      } else {
        manifest.skipped["skip-rule"] += 1;
      }
      continue;
    }

    const category = classificationToCategory(classification);
    if (!category) {
      manifest.skipped["skip-rule"] += 1;
      continue;
    }

    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(fullPath);
    } catch {
      manifest.skipped["read-error"] += 1;
      continue;
    }

    if (buffer.includes(0)) {
      manifest.skipped.binary += 1;
      continue;
    }

    if (manifest.loadedBytes + buffer.length > options.maxTotalBytes) {
      manifest.skipped["payload-limit"] += 1;
      continue;
    }

    const content = buffer.toString("utf-8");
    files.push({
      path: relativePath,
      content,
      category,
    });
    manifest.loaded += 1;
    manifest.loadedBytes += buffer.length;
    manifest.loadedPaths.push(relativePath);
  }
}

export function scanProject(
  projectPath: string,
  opts: ScanOptions = {},
): ProjectScanResult {
  const root = path.resolve(projectPath);
  const options: Required<ScanOptions> = {
    maxFiles: opts.maxFiles ?? DEFAULT_MAX_FILES,
    maxTotalBytes: opts.maxTotalBytes ?? DEFAULT_MAX_BYTES,
    maxDepth: opts.maxDepth ?? DEFAULT_MAX_DEPTH,
  };
  const files: ScannedFile[] = [];
  const manifest = createManifest(root);
  walkAndCollect(root, root, 0, files, manifest, options);
  const totalLines = files.reduce(
    (sum, f) => sum + f.content.split("\n").length,
    0,
  );
  const summary = `${files.length} files, ${totalLines} lines (${(manifest.loadedBytes / 1024).toFixed(1)} KB)`;
  return { files, summary, manifest };
}
