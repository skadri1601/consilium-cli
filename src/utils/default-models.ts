export const DEFAULT_MODELS = [
  "gpt-5.4-mini",
  "claude-haiku-4-5-20251001",
  "gemini-3-flash-preview",
] as const;

export const DEFAULT_BLIND_EVAL_MODELS = [
  "gpt-5.4-mini",
  "claude-haiku-4-5-20251001",
] as const;

export interface CatalogEntry {
  id: string;
  provider:
    | "openai"
    | "anthropic"
    | "google"
    | "groq"
    | "xai"
    | "moonshot"
    | "openrouter";
  tier: "fast" | "balanced" | "deep";
  status: "current" | "preview";
  notes?: string;
}

// Catalog contains only currently-supported models. Deprecated /
// retired models are removed (not tagged) so users never see a dead
// option in `consilium models` output. Aliases from legacy IDs to
// current IDs live in the engine's shared/config/models.py so a
// request for a deprecated model still resolves to a working one.
export const MODEL_CATALOG: readonly CatalogEntry[] = [
  { id: "gpt-5.5-pro", provider: "openai", tier: "deep", status: "current" },
  { id: "gpt-5.5", provider: "openai", tier: "balanced", status: "current" },
  { id: "gpt-5.4", provider: "openai", tier: "balanced", status: "current" },
  { id: "gpt-5.4-mini", provider: "openai", tier: "fast", status: "current" },
  { id: "gpt-5.4-nano", provider: "openai", tier: "fast", status: "current" },

  {
    id: "claude-opus-4-7",
    provider: "anthropic",
    tier: "deep",
    status: "current",
    notes: "platform default since 2026-04-23",
  },
  {
    id: "claude-opus-4-6",
    provider: "anthropic",
    tier: "deep",
    status: "current",
  },
  {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    tier: "balanced",
    status: "current",
  },
  {
    id: "claude-haiku-4-5-20251001",
    provider: "anthropic",
    tier: "fast",
    status: "current",
  },

  {
    id: "gemini-3.1-pro-preview",
    provider: "google",
    tier: "deep",
    status: "preview",
    notes: "current main text model",
  },
  {
    id: "gemini-3-flash-preview",
    provider: "google",
    tier: "fast",
    status: "preview",
  },

  {
    id: "llama-3.3-70b-versatile",
    provider: "groq",
    tier: "balanced",
    status: "current",
  },
  {
    id: "llama-3.1-8b-instant",
    provider: "groq",
    tier: "fast",
    status: "current",
  },
  {
    id: "openai/gpt-oss-120b",
    provider: "groq",
    tier: "deep",
    status: "current",
  },
  {
    id: "openai/gpt-oss-20b",
    provider: "groq",
    tier: "balanced",
    status: "current",
  },
  {
    id: "groq/compound",
    provider: "groq",
    tier: "deep",
    status: "current",
    notes: "agentic system with web search + code exec",
  },
  {
    id: "groq/compound-mini",
    provider: "groq",
    tier: "balanced",
    status: "current",
  },

  {
    id: "grok-4.20",
    provider: "xai",
    tier: "deep",
    status: "current",
    notes: "Grok 4.20 flagship (multi-agent reasoning)",
  },
  {
    id: "grok-4-1-fast-reasoning",
    provider: "xai",
    tier: "fast",
    status: "current",
  },
  {
    id: "grok-4-1-fast-non-reasoning",
    provider: "xai",
    tier: "fast",
    status: "current",
  },
  {
    id: "grok-code-fast-1",
    provider: "xai",
    tier: "fast",
    status: "current",
    notes: "agentic coding",
  },

  {
    id: "kimi-k2.6",
    provider: "moonshot",
    tier: "deep",
    status: "current",
    notes: "256K ctx, tool-use (OpenAI-compatible)",
  },
  {
    id: "kimi-k2.5",
    provider: "moonshot",
    tier: "balanced",
    status: "current",
  },
  {
    id: "kimi-k2-thinking",
    provider: "moonshot",
    tier: "deep",
    status: "current",
    notes: "thinking-enabled variant",
  },
  {
    id: "kimi-k2-thinking-turbo",
    provider: "moonshot",
    tier: "balanced",
    status: "current",
    notes: "fast thinking variant",
  },
  {
    id: "kimi-k2-turbo-preview",
    provider: "moonshot",
    tier: "fast",
    status: "current",
    notes: "low-latency turbo preview",
  },

  {
    id: "google/gemma-4-26b-a4b-it:free",
    provider: "openrouter",
    tier: "fast",
    status: "current",
    notes: "free tier (Gemma 4 26B activated)",
  },
  {
    id: "google/gemma-4-31b-it:free",
    provider: "openrouter",
    tier: "balanced",
    status: "current",
    notes: "free tier (Gemma 4 31B)",
  },
  {
    id: "qwen/qwen3-coder:free",
    provider: "openrouter",
    tier: "balanced",
    status: "current",
    notes: "free tier (Qwen3 Coder)",
  },
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    provider: "openrouter",
    tier: "deep",
    status: "current",
    notes: "free tier (Nemotron 3 Super 120B)",
  },
  {
    id: "inclusionai/ling-2.6-1t:free",
    provider: "openrouter",
    tier: "deep",
    status: "current",
    notes: "free tier (Ling 2.6 1T)",
  },
];

export function findCatalogEntry(id: string): CatalogEntry | undefined {
  return MODEL_CATALOG.find((entry) => entry.id === id);
}

export function isDeprecatedOrRetired(_id: string): boolean {
  // Deprecated models are no longer present in the catalog - this
  // helper stays for API compatibility with the `models --check`
  // command but will always return false now.
  return false;
}
