import * as path from "node:path";

export interface ArchitectureInfo {
  patterns: string[];
  keyAbstractions: string[];
  dataFlow: string[];
  sourceFileCount: number;
}

const DIR_PATTERN_RULES: Array<{ dirs: string[]; pattern: string }> = [
  {
    dirs: ["controllers", "models", "views", "controller", "model", "view"],
    pattern: "MVC",
  },
  { dirs: ["services", "service"], pattern: "service-layer" },
  { dirs: ["middleware", "middlewares"], pattern: "middleware" },
  { dirs: ["resolvers", "schema", "graphql"], pattern: "GraphQL" },
  { dirs: ["routes", "api"], pattern: "REST" },
  { dirs: ["components", "pages", "hooks"], pattern: "component-based" },
  { dirs: ["commands", "handlers", "events"], pattern: "CQRS" },
  { dirs: ["repositories", "repository"], pattern: "repository" },
];

function hasAnyDir(dirNames: Set<string>, dirs: string[]): boolean {
  return dirs.some((d) => dirNames.has(d));
}

function collectDirPatterns(dirNames: Set<string>): string[] {
  const patterns: string[] = [];
  for (const rule of DIR_PATTERN_RULES) {
    if (hasAnyDir(dirNames, rule.dirs)) patterns.push(rule.pattern);
  }
  return patterns;
}

function detectDockerPattern(
  filePaths: string[],
  dirs: Set<string>,
  patterns: string[],
): void {
  let hasDockerCompose = false;
  let dockerfileCount = 0;
  for (const fp of filePaths) {
    if (fp.includes("docker-compose")) hasDockerCompose = true;
    if (fp.includes("Dockerfile")) dockerfileCount += 1;
  }
  if (hasDockerCompose && dockerfileCount > 1) {
    patterns.push("microservices");
  } else if (dirs.size > 0 && !patterns.includes("microservices")) {
    patterns.push("monolith");
  }
}

function detectServerlessPattern(
  sourceFiles: Map<string, string>,
  filePaths: string[],
): boolean {
  for (const [, content] of sourceFiles) {
    if (
      content.includes("serverless") ||
      content.includes("lambda") ||
      content.includes("@aws-cdk")
    ) {
      return true;
    }
  }
  return filePaths.some(
    (f) => f.includes("serverless.yml") || f.includes("serverless.ts"),
  );
}

function detectPatterns(
  sourceFiles: Map<string, string>,
  filePaths: string[],
): string[] {
  const dirNames = new Set(
    filePaths.flatMap((f) => path.dirname(f).split(path.sep)),
  );
  const dirs = new Set(filePaths.map((f) => path.dirname(f)));
  const patterns = collectDirPatterns(dirNames);
  detectDockerPattern(filePaths, dirs, patterns);
  if (detectServerlessPattern(sourceFiles, filePaths)) {
    patterns.push("serverless");
  }
  return [...new Set(patterns)];
}

const classRegex = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g;
const interfaceRegex = /(?:export\s+)?interface\s+(\w+)/g;
const typeRegex = /(?:export\s+)?type\s+(\w+)/g;

function collectSymbolNames(
  content: string,
  regex: RegExp,
  sink: Set<string>,
): void {
  regex.lastIndex = 0;
  let match;
  while ((match = regex.exec(content)) !== null) {
    if (match[1]) sink.add(match[1]);
  }
}

function detectAbstractions(sourceFiles: Map<string, string>): string[] {
  const abstractions = new Set<string>();
  for (const [, content] of sourceFiles) {
    collectSymbolNames(content, classRegex, abstractions);
    collectSymbolNames(content, interfaceRegex, abstractions);
    collectSymbolNames(content, typeRegex, abstractions);
  }
  return Array.from(abstractions).slice(0, 50);
}

const DATA_FLOW_RULES: Array<{ needles: string[]; label: string }> = [
  { needles: ["fetch(", "axios", "http.get"], label: "HTTP client" },
  {
    needles: ["createConnection", "mongoose", "prisma", "sequelize"],
    label: "database",
  },
  { needles: ["Redis", "redis", "ioredis"], label: "cache" },
  { needles: ["WebSocket", "socket.io", "ws"], label: "websocket" },
  { needles: ["amqp", "rabbitmq", "kafka", "bullmq"], label: "message-queue" },
  { needles: ["createReadStream", "pipeline", "Transform"], label: "streams" },
  { needles: ["EventEmitter", "on(", "emit("], label: "event-driven" },
];

function detectDataFlow(sourceFiles: Map<string, string>): string[] {
  const flows: string[] = [];
  const allContent = Array.from(sourceFiles.values()).join("\n");
  for (const rule of DATA_FLOW_RULES) {
    if (rule.needles.some((n) => allContent.includes(n))) {
      flows.push(rule.label);
    }
  }
  return flows;
}

export function analyzeArchitecture(
  sourceFiles: Map<string, string>,
): ArchitectureInfo {
  const filePaths = Array.from(sourceFiles.keys());

  return {
    patterns: detectPatterns(sourceFiles, filePaths),
    keyAbstractions: detectAbstractions(sourceFiles),
    dataFlow: detectDataFlow(sourceFiles),
    sourceFileCount: sourceFiles.size,
  };
}
