import fs from "node:fs";
import path from "node:path";

const SERVICE_KEYWORDS: Record<string, string[]> = {
  stripe: ["STRIPE"],
  clerk: ["CLERK", "NEXT_PUBLIC_CLERK"],
  redis: ["REDIS", "UPSTASH"],
  postgresql: ["DATABASE_URL", "POSTGRES", "PG_"],
  sentry: ["SENTRY"],
  openai: ["OPENAI"],
  anthropic: ["ANTHROPIC"],
  google: ["GOOGLE_API", "GOOGLE_CLOUD"],
  vercel: ["VERCEL"],
  aws: ["AWS_"],
  supabase: ["SUPABASE"],
  firebase: ["FIREBASE"],
  twilio: ["TWILIO"],
  sendgrid: ["SENDGRID"],
  slack: ["SLACK"],
  linear: ["LINEAR"],
  github: ["GITHUB_TOKEN", "GH_TOKEN"],
  docker: ["DOCKER"],
  neon: ["NEON"],
};

export interface EnvMetadata {
  integrations: string[];
  variableCount: number;
}

// Whitelist of env-file basenames we read. Keeping this as a literal
// constant means `path.join(projectDir, envFile)` can only ever produce
// a path of the form `<projectDir>/.env*` - there is no way for envFile
// itself to contain a traversal segment.
const ENV_FILES = [
  ".env",
  ".env.local",
  ".env.example",
  ".env.development",
] as const;

function _resolveSafeEnvPath(
  projectDir: string,
  envFile: string,
): string | null {
  // Resolve both ends to absolute, canonical paths and verify the env
  // file lives directly inside projectDir (no symlink-traversal,
  // no `..`). Sonar's typescript:S5443 / S2083 path-injection rule
  // wants the sanitization at the SINK - keep it inline here.
  const projectRoot = path.resolve(projectDir);
  const resolved = path.resolve(projectRoot, envFile);
  if (path.dirname(resolved) !== projectRoot) {
    return null;
  }
  if (!ENV_FILES.includes(envFile as (typeof ENV_FILES)[number])) {
    return null;
  }
  return resolved;
}

export function extractEnvMetadata(projectDir: string): EnvMetadata | null {
  const foundVars = new Set<string>();
  const integrations = new Set<string>();

  for (const envFile of ENV_FILES) {
    const fullPath = _resolveSafeEnvPath(projectDir, envFile);
    if (!fullPath) continue;
    try {
      if (!fs.existsSync(fullPath)) continue;
      const content = fs.readFileSync(fullPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex <= 0) continue;
        const varName = trimmed.slice(0, eqIndex).trim();
        foundVars.add(varName);

        for (const [service, keywords] of Object.entries(SERVICE_KEYWORDS)) {
          if (keywords.some((kw) => varName.startsWith(kw))) {
            integrations.add(service);
          }
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code && code !== "ENOENT") {
        console.warn(`[consilium] env extraction skipped: ${code}`);
      }
    }
  }

  if (foundVars.size === 0) return null;

  return {
    // Use locale-aware compare so the result is reliably ordered across
    // locales (typescript:S6829 / sort-without-locale).
    integrations: Array.from(integrations).sort((a, b) => a.localeCompare(b)),
    variableCount: foundVars.size,
  };
}
