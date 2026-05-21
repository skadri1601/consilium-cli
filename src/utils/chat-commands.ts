import fs from "node:fs";
import path from "node:path";
import { style, border, contentLine, borderBottom } from "./visual-system";
import { terminal } from "./terminal-capabilities";
import { SessionManager } from "./session-manager";
import { ChatSession } from "../commands/chat-session";
import {
  DebateMode,
  DEBATE_MODES,
  isValidMode,
  estimateCost,
  formatCostEstimate,
} from "./debate-modes";
import { OutputFormat, isValidOutputFormat } from "./output-formatter";

const s = style();
const w = terminal.width;

export function handleConversationsCommand(
  sessionManager: SessionManager,
): void {
  const sessions = sessionManager.listSessions();

  if (sessions.length === 0) {
    console.log(s.dim("  No conversations found."));
    return;
  }

  console.log(border("Conversations", w));

  const idW = 16;
  const topicW = Math.max(20, w - idW - 14 - 12 - 12);
  const header =
    "ID".padEnd(idW) +
    "Topic".padEnd(topicW) +
    "Debates".padStart(8) +
    "  " +
    "Date".padStart(12);
  console.log(contentLine(s.bold(header), w));

  for (const sess of sessions.slice(0, 20)) {
    const id =
      sess.id.length > idW - 2 ? sess.id.slice(0, idW - 3) + ".." : sess.id;
    const topic =
      sess.topic.length > topicW - 2
        ? sess.topic.slice(0, topicW - 3) + ".."
        : sess.topic;
    const date = sessionManager.formatRelativeTime(sess.updatedAt);
    const line =
      id.padEnd(idW) +
      topic.padEnd(topicW) +
      String(sess.debateCount).padStart(8) +
      "  " +
      date.padStart(12);
    console.log(contentLine(line, w));
  }

  console.log(borderBottom(w));
  console.log(s.dim(`  ${sessions.length} conversation(s) total`));
}

function logContextFiles(
  files: { name: string; size: number }[],
  totalFileSize: number,
): void {
  console.log(
    contentLine(
      `Files in context: ${files.length}  (${totalFileSize} bytes total)`,
      w,
    ),
  );
  for (const f of files) {
    console.log(contentLine(`  ${s.dim(f.name)}  ${f.size} bytes`, w));
  }
}

function logContextTokenBudget(
  totalFileSize: number,
  followUpChars: number,
): void {
  const fileTokens = Math.ceil(totalFileSize / 4);
  const followUpTokens = Math.ceil(followUpChars / 4);
  const decisionLogTokens = 0;
  const used = fileTokens + followUpTokens + decisionLogTokens;
  const budget = 12000;
  const remaining = Math.max(0, budget - used);
  console.log(contentLine("", w));
  console.log(contentLine(s.bold("Estimated token usage:"), w));
  console.log(contentLine(`  File context:      ~${fileTokens} tokens`, w));
  console.log(contentLine(`  Follow-up context: ~${followUpTokens} tokens`, w));
  console.log(
    contentLine(`  Decision log:      ~${decisionLogTokens} tokens`, w),
  );
  console.log(
    contentLine(`  Remaining budget:  ~${remaining} of ${budget} tokens`, w),
  );
}

export function handleContextCommand(session: ChatSession): void {
  const cm = session.contextManager;
  const files = cm.getFiles();
  const images = cm.getImages();
  const totalFileSize = cm.getTotalSize();
  const synthesesCount = session.debates.filter((d) => d.goldenPrompt).length;
  const followUpChars = session.debates
    .filter((d) => d.goldenPrompt)
    .slice(-5)
    .reduce((sum, d) => sum + (d.goldenPrompt?.length ?? 0), 0);

  console.log(border("Context Window", w));
  logContextFiles(files, totalFileSize);
  console.log(contentLine(`Images in context: ${images.length}`, w));
  console.log(
    contentLine(
      `Previous syntheses used: ${Math.min(synthesesCount, 5)} of ${synthesesCount}`,
      w,
    ),
  );
  logContextTokenBudget(totalFileSize, followUpChars);
  console.log(borderBottom(w));
}

export function handleModeCommand(
  args: string[],
  currentMode: string,
): { mode: string; changed: boolean } {
  if (args.length === 0) {
    console.log(border("Debate Mode", w));
    console.log(contentLine(`Current mode: ${s.brand(currentMode)}`, w));
    const config = DEBATE_MODES[currentMode as DebateMode];
    if (config) {
      console.log(contentLine(`  ${config.description}`, w));
      console.log(
        contentLine(
          `  Rounds: ${config.rounds}  Sub-agents: ${config.subAgents ? "yes" : "no"}`,
          w,
        ),
      );
    }
    console.log(contentLine("", w));
    console.log(contentLine("Available modes:", w));
    for (const [name, cfg] of Object.entries(DEBATE_MODES)) {
      const marker = name === currentMode ? s.brand("*") : " ";
      console.log(
        contentLine(`  ${marker} ${name.padEnd(10)} ${cfg.description}`, w),
      );
    }
    console.log(borderBottom(w));
    return { mode: currentMode, changed: false };
  }

  const requested = (args[0] ?? "").toLowerCase();
  if (!isValidMode(requested)) {
    console.log(s.error(`  Invalid mode: ${requested}`));
    console.log(
      s.dim(`  Valid modes: ${Object.keys(DEBATE_MODES).join(", ")}`),
    );
    return { mode: currentMode, changed: false };
  }

  const config = DEBATE_MODES[requested];
  console.log(s.success(`  Mode set to ${requested}`));
  console.log(s.dim(`  ${config?.description ?? ""}`));
  return { mode: requested, changed: true };
}

export function handleEstimateCommand(mode: string, modelCount: number): void {
  if (!isValidMode(mode)) {
    console.log(s.error(`  Unknown mode: ${mode}`));
    return;
  }

  const estimate = estimateCost(mode, modelCount);

  console.log(border("Cost Estimate", w));
  console.log(contentLine(`Mode: ${s.brand(mode)}  Models: ${modelCount}`, w));
  console.log(contentLine("", w));

  const formatted = formatCostEstimate(estimate);
  for (const line of formatted.split("\n")) {
    console.log(contentLine(line, w));
  }

  console.log(borderBottom(w));
}

export function handleCancelCommand(): { shouldCancel: boolean } {
  console.log(
    s.warning("  Cancellation requested. The current debate will be stopped."),
  );
  return { shouldCancel: true };
}

export function handleSkipCommand(): { shouldSkip: boolean } {
  console.log(
    s.warning(
      "  Skipping remaining rounds. Judge will synthesize from available responses.",
    ),
  );
  return { shouldSkip: true };
}

export function handleOutputCommand(
  args: string[],
  currentFormat: string,
): { format: string; changed: boolean } {
  const validFormats: OutputFormat[] = [
    "markdown",
    "cursorrules",
    "claude-md",
    "json",
    "text",
  ];

  if (args.length === 0) {
    console.log(border("Output Format", w));
    console.log(contentLine(`Current format: ${s.brand(currentFormat)}`, w));
    console.log(contentLine("", w));
    console.log(contentLine("Available formats:", w));
    for (const fmt of validFormats) {
      const marker = fmt === currentFormat ? s.brand("*") : " ";
      console.log(contentLine(`  ${marker} ${fmt}`, w));
    }
    console.log(borderBottom(w));
    return { format: currentFormat, changed: false };
  }

  const requested = (args[0] ?? "").toLowerCase();
  if (!isValidOutputFormat(requested)) {
    console.log(s.error(`  Invalid format: ${requested}`));
    console.log(s.dim(`  Valid formats: ${validFormats.join(", ")}`));
    return { format: currentFormat, changed: false };
  }

  console.log(s.success(`  Output format set to ${requested}`));
  return { format: requested, changed: true };
}

const WORKSPACE_CHECKS: Array<{
  file: string;
  label: string;
  isKeyFile?: boolean;
}> = [
  { file: "package.json", label: "Node.js", isKeyFile: true },
  { file: "tsconfig.json", label: "TypeScript", isKeyFile: true },
  { file: "Cargo.toml", label: "Rust", isKeyFile: true },
  { file: "go.mod", label: "Go", isKeyFile: true },
  { file: "pyproject.toml", label: "Python", isKeyFile: true },
  { file: "requirements.txt", label: "Python", isKeyFile: true },
  { file: "pom.xml", label: "Java/Maven", isKeyFile: true },
  { file: "build.gradle", label: "Java/Gradle", isKeyFile: true },
  { file: ".gitignore", label: "", isKeyFile: true },
  { file: "Dockerfile", label: "Docker", isKeyFile: true },
  { file: "docker-compose.yml", label: "Docker Compose", isKeyFile: true },
  { file: "next.config.js", label: "Next.js" },
  { file: "next.config.mjs", label: "Next.js" },
  { file: "next.config.ts", label: "Next.js" },
  { file: "vite.config.ts", label: "Vite" },
  { file: "angular.json", label: "Angular" },
  { file: "prisma/schema.prisma", label: "Prisma" },
  { file: ".env", label: "", isKeyFile: true },
  { file: ".env.example", label: "", isKeyFile: true },
];

function scanWorkspaceFiles(projectPath: string): {
  detected: string[];
  keyFiles: string[];
} {
  const detected: string[] = [];
  const keyFiles: string[] = [];
  for (const check of WORKSPACE_CHECKS) {
    const fullPath = path.join(projectPath, check.file);
    if (!fs.existsSync(fullPath)) continue;
    if (check.label) detected.push(check.label);
    if (check.isKeyFile) keyFiles.push(check.file);
  }
  return { detected, keyFiles };
}

function resolveWorkspaceLanguage(unique: Set<string>): string {
  if (unique.has("TypeScript")) return "TypeScript";
  if (unique.has("Node.js")) return "JavaScript";
  if (unique.has("Rust")) return "Rust";
  if (unique.has("Go")) return "Go";
  if (unique.has("Python")) return "Python";
  if (unique.has("Java/Maven") || unique.has("Java/Gradle")) return "Java";
  return "Unknown";
}

function resolveWorkspaceFramework(unique: Set<string>): {
  projectType: string;
  framework: string;
} {
  if (unique.has("Next.js"))
    return { projectType: "Web Application", framework: "Next.js" };
  if (unique.has("Vite"))
    return { projectType: "Web Application", framework: "Vite" };
  if (unique.has("Angular"))
    return { projectType: "Web Application", framework: "Angular" };
  if (unique.has("Node.js") || unique.has("TypeScript")) {
    return { projectType: "Node.js Project", framework: "" };
  }
  return { projectType: "Unknown", framework: "" };
}

function appendStackTools(unique: Set<string>, framework: string): string {
  let out = framework;
  if (unique.has("Prisma")) out = out ? `${out} + Prisma` : "Prisma";
  if (unique.has("Docker")) out = out ? `${out} + Docker` : "Docker";
  return out;
}

export async function handleWorkspaceCommand(
  projectPath: string,
): Promise<void> {
  console.log(border("Workspace", w));
  console.log(contentLine(`Path: ${projectPath}`, w));

  const { detected, keyFiles } = scanWorkspaceFiles(projectPath);
  const uniqueDetected = new Set(detected);
  const language = resolveWorkspaceLanguage(uniqueDetected);
  let { projectType, framework } = resolveWorkspaceFramework(uniqueDetected);
  framework = appendStackTools(uniqueDetected, framework);

  console.log(contentLine(`Type:      ${projectType}`, w));
  console.log(contentLine(`Language:  ${language}`, w));
  if (framework) {
    console.log(contentLine(`Framework: ${framework}`, w));
  }

  if (keyFiles.length > 0) {
    console.log(contentLine("", w));
    console.log(contentLine(s.bold("Key files:"), w));
    for (const kf of keyFiles) {
      console.log(contentLine(`  ${s.dim(kf)}`, w));
    }
  }

  console.log(borderBottom(w));
}
