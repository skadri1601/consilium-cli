import { loadConfig, saveConfig } from "./config";
import { resolveApiKey } from "./api-key-helper";

export type Provider =
  | "openai"
  | "anthropic"
  | "google"
  | "groq"
  | "xai"
  | "moonshot"
  | "openrouter";

export const PROVIDER_ENV_VARS: Record<Provider, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_API_KEY",
  groq: "GROQ_API_KEY",
  xai: "XAI_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export const PROVIDER_DISPLAY_NAMES: Record<Provider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google/Gemini",
  groq: "Groq",
  xai: "xAI/Grok",
  moonshot: "Moonshot/Kimi",
  openrouter: "OpenRouter",
};

const ALL_PROVIDERS: Provider[] = [
  "openai",
  "anthropic",
  "google",
  "groq",
  "xai",
  "moonshot",
  "openrouter",
];

const MODEL_PROVIDER_MAP: Record<string, Provider> = {
  // OpenAI (GPT-5.x family)
  "gpt-5.5-pro": "openai",
  "gpt-5.5": "openai",
  "gpt-5.4": "openai",
  "gpt-5.4-mini": "openai",
  "gpt-5.4-nano": "openai",
  // Anthropic (Claude 4.x family)
  "claude-opus-4-7": "anthropic",
  "claude-opus-4-6": "anthropic",
  "claude-sonnet-4-6": "anthropic",
  "claude-haiku-4-5-20251001": "anthropic",
  // Google (Gemini 3.x family)
  "gemini-3.1-pro-preview": "google",
  "gemini-3-flash-preview": "google",
  "gemini-3.1-flash-lite-preview": "google",
  // Groq
  "llama-3.3-70b-versatile": "groq",
  "llama-3.1-8b-instant": "groq",
  "openai/gpt-oss-120b": "groq",
  "openai/gpt-oss-20b": "groq",
  "groq/compound": "groq",
  "groq/compound-mini": "groq",
  // xAI (Grok 4.x family)
  "grok-4-20": "xai",
  "grok-4-1-fast-reasoning": "xai",
  "grok-4-1-fast-non-reasoning": "xai",
  "grok-code-fast-1": "xai",
  // Moonshot
  "kimi-k2.6": "moonshot",
  "kimi-k2.5": "moonshot",
  "kimi-k2-thinking": "moonshot",
  "kimi-k2-thinking-turbo": "moonshot",
  "kimi-k2-turbo-preview": "moonshot",
  // OpenRouter free models (also reachable via platform free-tier pool)
  "google/gemma-4-26b-a4b-it:free": "openrouter",
  "google/gemma-4-31b-it:free": "openrouter",
  "qwen/qwen3-coder:free": "openrouter",
  "nvidia/nemotron-3-super-120b-a12b:free": "openrouter",
  "inclusionai/ling-2.6-1t:free": "openrouter",
};

const JUDGE_PRIORITY: Provider[] = [
  "anthropic",
  "google",
  "openai",
  "xai",
  "moonshot",
  "groq",
  "openrouter",
];

export class KeyManager {
  getKey(provider: Provider): string | undefined {
    const envVar = PROVIDER_ENV_VARS[provider];
    const envValue = process.env[envVar];
    if (envValue) return envValue;
    const keys = this.loadProviderKeys();
    return keys[provider];
  }

  async getKeyAsync(provider: Provider): Promise<string | undefined> {
    const fromHelper = await resolveApiKey(provider);
    if (fromHelper) return fromHelper;
    return this.getKey(provider);
  }

  async resolveKeysForModelsAsync(
    models: string[],
  ): Promise<Map<string, string | undefined>> {
    const result = new Map<string, string | undefined>();
    for (const model of models) {
      const provider = MODEL_PROVIDER_MAP[model];
      result.set(
        model,
        provider ? await this.getKeyAsync(provider) : undefined,
      );
    }
    return result;
  }

  setKey(provider: Provider, key: string): void {
    const keys = this.loadProviderKeys();
    keys[provider] = key;
    this.saveProviderKeys(keys);
  }

  removeKey(provider: Provider): void {
    const keys = this.loadProviderKeys();
    delete keys[provider];
    this.saveProviderKeys(keys);
  }

  listKeys(): Array<{
    provider: Provider;
    source: "env" | "config";
    masked: string;
  }> {
    const result: Array<{
      provider: Provider;
      source: "env" | "config";
      masked: string;
    }> = [];
    const configKeys = this.loadProviderKeys();

    for (const provider of ALL_PROVIDERS) {
      const envVar = PROVIDER_ENV_VARS[provider];
      const envValue = process.env[envVar];
      if (envValue) {
        result.push({
          provider,
          source: "env",
          masked: this.maskKey(envValue),
        });
      } else if (configKeys[provider]) {
        result.push({
          provider,
          source: "config",
          masked: this.maskKey(configKeys[provider]),
        });
      }
    }

    return result;
  }

  hasKey(provider: Provider): boolean {
    return this.getKey(provider) !== undefined;
  }

  getAvailableProviders(): Provider[] {
    return ALL_PROVIDERS.filter((p) => this.hasKey(p));
  }

  resolveKeysForModels(models: string[]): Map<string, string | undefined> {
    const result = new Map<string, string | undefined>();
    for (const model of models) {
      const provider = MODEL_PROVIDER_MAP[model];
      result.set(model, provider ? this.getKey(provider) : undefined);
    }
    return result;
  }

  getJudgeProvider(debateModels: string[]): Provider | undefined {
    const debateProviders = new Set(
      debateModels.map((m) => MODEL_PROVIDER_MAP[m]).filter(Boolean),
    );

    for (const candidate of JUDGE_PRIORITY) {
      if (!debateProviders.has(candidate) && this.hasKey(candidate)) {
        return candidate;
      }
    }

    for (const candidate of JUDGE_PRIORITY) {
      if (this.hasKey(candidate)) {
        return candidate;
      }
    }

    return undefined;
  }

  private loadProviderKeys(): Record<string, string> {
    const config = loadConfig() as any;
    return config.providerKeys || {};
  }

  private saveProviderKeys(keys: Record<string, string>): void {
    const config = loadConfig() as any;
    config.providerKeys = keys;
    saveConfig(config);
  }

  private maskKey(key: string): string {
    if (key.length <= 8) return "****";
    return key.slice(0, 4) + "..." + key.slice(-4);
  }
}
