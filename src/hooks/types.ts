export type HookEvent =
  | "SessionStart"
  | "SessionEnd"
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "Stop"
  | "PermissionRequest";

export const HOOK_EVENTS: readonly HookEvent[] = [
  "SessionStart",
  "SessionEnd",
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "Stop",
  "PermissionRequest",
];

export interface HookMatcher {
  tool?: string;
  promptPattern?: string;
}

export interface CommandHookEntry {
  type: "command";
  command: string;
  matcher?: HookMatcher;
  timeoutMs?: number;
}

export interface HttpHookEntry {
  type: "http";
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  matcher?: HookMatcher;
  timeoutMs?: number;
}

export type HookEntry = CommandHookEntry | HttpHookEntry;

export interface HookConfig {
  hooks: Partial<Record<HookEvent, HookEntry[]>>;
}

export interface HookResult {
  ok: boolean;
  output?: string;
  error?: string;
  block?: boolean;
}

export interface HookRunnerOptions {
  hooks?: HookConfig;
  allowedHookUrls?: string[];
  enabled?: boolean;
  timeoutMs?: number;
}
