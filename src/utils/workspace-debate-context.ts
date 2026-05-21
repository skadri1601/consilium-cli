import { requestCodebasePermission } from "./codebase-permissions";
import { detectWorkspace } from "./workspace-detector";
import { extractEnvMetadata } from "./env-extractor";
import { collectGitContext, formatGitContextForPrompt } from "./git-context";
import { fetchTicket, formatTicketForPrompt } from "./linear-client";
import {
  scanProject,
  type ScanManifest,
  type ScannedFile,
} from "./project-scanner";
import { resolveProjectRoot } from "./project-root";
import { formatMemoryForPrompt } from "./project-memory";
import { style } from "./visual-system";

const st = style();

export interface WorkspaceDebateContextOptions {
  noContext?: boolean;
  /**
   * Opt out of auto-attaching git diff/branch/recent commits.
   * Defaults to false - every debate inside a git repo includes
   * git context so the council can reason about WIP.
   */
  noGit?: boolean;
  /** Legacy alias for default-on git context. Kept for back-compat. */
  gitDiff?: boolean;
  ticket?: string;
}

export interface WorkspaceDebateContext {
  files: Array<{ name: string; content: string }>;
  projectFiles: ScannedFile[];
  projectContext: Record<string, unknown>;
  gitContextPrefix: string;
  ticketPrefix: string;
  /** Markdown summary of recent past debates in this project - prepended to the topic. */
  memoryPrefix: string;
  rootPath: string;
  contextManifest: ScanManifest;
}

export async function loadWorkspaceDebateContext(
  options: WorkspaceDebateContextOptions,
  cwd = process.cwd(),
): Promise<WorkspaceDebateContext | null> {
  if (options.noContext) return null;

  const rootInfo = resolveProjectRoot(cwd);
  if (rootInfo.isSubdirectory) {
    console.log(
      st.dim(
        `  Tip: running Consilium from project root (${rootInfo.root}) improves context coverage and edit accuracy.`,
      ),
    );
  }

  const permitted = await requestCodebasePermission(rootInfo.root);
  if (!permitted) return null;

  const workspace = detectWorkspace(rootInfo.root);
  const scanResult = scanProject(rootInfo.root);
  const projectFiles = scanResult.files;

  const HIGH_PRIORITY = new Set([
    "package.json",
    "tsconfig.json",
    "pyproject.toml",
    "Cargo.toml",
    "schema.prisma",
    ".env.example",
    "docker-compose.yml",
    "Dockerfile",
  ]);
  const priorityScore = (p: string): number => {
    const base = p.split(/[/\\]/).pop() || "";
    if (HIGH_PRIORITY.has(base)) return 0;
    if (base.endsWith(".prisma")) return 1;
    if (p.includes("/src/") || p.includes("\\src\\")) return 2;
    if (p.startsWith(".github/")) return 8;
    if (p.includes("/docs/") || p.includes("\\docs\\")) return 7;
    if (
      p.includes("/test") ||
      p.includes("\\test") ||
      p.includes(".test.") ||
      p.includes(".spec.")
    )
      return 6;
    return 4;
  };
  const sortedFiles = [...projectFiles].sort(
    (a, b) => priorityScore(a.path) - priorityScore(b.path),
  );

  const PAYLOAD_BUDGET = 512 * 1024;
  let totalBytes = 0;
  const files: Array<{ name: string; content: string }> = [];
  for (const f of sortedFiles) {
    const size = Buffer.byteLength(f.content, "utf-8");
    if (totalBytes + size > PAYLOAD_BUDGET) break;
    totalBytes += size;
    files.push({ name: f.path, content: f.content });
  }

  const envMeta = extractEnvMetadata(rootInfo.root);

  const projectContext: Record<string, unknown> = {
    rootPath: rootInfo.root,
    cwd: rootInfo.cwd,
    isGitRepo: rootInfo.isGitRepo,
    launchedFromSubdirectory: rootInfo.isSubdirectory,
    projectType: workspace.projectType,
    language: workspace.language,
    framework: workspace.framework,
    packageManager: workspace.packageManager,
    hasTests: workspace.hasTests,
    hasDocker: workspace.hasDocker,
    hasCI: workspace.hasCI,
  };
  if (envMeta) {
    projectContext.integrations = envMeta.integrations;
  }

  let gitContextPrefix = "";
  // Auto-attach git context when inside a repo. The previous default
  // forced developers to remember --git-diff, which meant most debates
  // happened without the WIP / branch / recent-commits the council needs
  // to reason about "why is this failing?" or "is this a regression?"
  // questions. Now: on by default; pass --no-git to opt out.
  const shouldCollectGit = !options.noGit && rootInfo.isGitRepo;
  if (shouldCollectGit) {
    const gitCtx = collectGitContext(rootInfo.root);
    if (gitCtx?.diff || gitCtx?.branch) {
      gitContextPrefix = formatGitContextForPrompt(gitCtx);
      const branch = gitCtx.branch || "unknown";
      const diffNote = gitCtx.diff ? "" : " - no uncommitted changes";
      console.log(
        st.dim(`  Attached git context (branch: ${branch}${diffNote})`),
      );
    }
  }

  // Project memory: surface what the council previously decided here so
  // a follow-up debate can build on prior conclusions instead of re-deriving.
  // Reads .consilium/memory.md; empty string when no entries.
  const { text: memoryPrefix, count: entryCount } = formatMemoryForPrompt(
    rootInfo.root,
  );
  if (memoryPrefix) {
    console.log(
      st.dim(
        `  Loaded project memory (${entryCount} prior debate${entryCount === 1 ? "" : "s"} in .consilium/memory.md)`,
      ),
    );
  }

  let ticketPrefix = "";
  if (options.ticket) {
    try {
      const ticket = await fetchTicket(options.ticket);
      if (ticket) {
        ticketPrefix = formatTicketForPrompt(ticket);
        console.log(
          st.dim(`  Loaded ticket: ${ticket.identifier} - ${ticket.title}`),
        );
      } else {
        console.log(
          st.dim(
            `  Could not fetch ticket ${options.ticket} (check LINEAR_API_KEY)`,
          ),
        );
      }
    } catch {
      console.log(st.dim(`  Could not fetch ticket ${options.ticket}`));
    }
  }

  if (files.length > 0) {
    const sentKB = (totalBytes / 1024).toFixed(1);
    const scannedKB = (scanResult.manifest.loadedBytes / 1024).toFixed(1);
    const trimmed = files.length < projectFiles.length;
    console.log(
      st.dim(
        `  Loaded ${files.length} context files (${sentKB} KB)${trimmed ? ` - trimmed from ${projectFiles.length} scanned (${scannedKB} KB)` : ""}`,
      ),
    );
    console.log(
      st.dim(
        `  Skipped - secret:${scanResult.manifest.skipped.secret} binary:${scanResult.manifest.skipped.binary} payload-limit:${scanResult.manifest.skipped["payload-limit"]} skip-rule:${scanResult.manifest.skipped["skip-rule"]}`,
      ),
    );
  } else {
    console.log(
      st.dim("  No readable context files loaded from project root."),
    );
  }
  if (envMeta?.integrations.length) {
    console.log(
      st.dim(`  Detected integrations: ${envMeta.integrations.join(", ")}`),
    );
  }

  const budgetedProjectFiles = projectFiles.slice(0, files.length);

  return {
    files,
    projectFiles: budgetedProjectFiles,
    projectContext,
    gitContextPrefix,
    ticketPrefix,
    memoryPrefix,
    rootPath: rootInfo.root,
    contextManifest: scanResult.manifest,
  };
}
