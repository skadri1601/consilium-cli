import { KeyManager, type Provider } from "./key-manager";

export type { Provider };

export interface KeyCheckResult {
  provider: Provider;
  valid: boolean;
  error?: string;
  modelCount?: number;
}

const PROVIDER_ENDPOINTS: Record<
  Provider,
  {
    url: (key: string) => string;
    auth: (key: string) => Record<string, string>;
  }
> = {
  openai: {
    url: () => "https://api.openai.com/v1/models",
    auth: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  anthropic: {
    url: () => "https://api.anthropic.com/v1/models",
    auth: (key) => ({
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    }),
  },
  google: {
    url: (key) =>
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    auth: () => ({}),
  },
  groq: {
    url: () => "https://api.groq.com/openai/v1/models",
    auth: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  xai: {
    url: () => "https://api.x.ai/v1/models",
    auth: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  moonshot: {
    url: () => "https://api.moonshot.cn/v1/models",
    auth: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  openrouter: {
    url: () => "https://openrouter.ai/api/v1/auth/key",
    auth: (key) => ({ Authorization: `Bearer ${key}` }),
  },
};

const TIMEOUT_MS = 3000;

function countModels(provider: Provider, body: unknown): number | undefined {
  if (!body || typeof body !== "object") return undefined;
  const obj = body as Record<string, unknown>;
  if (provider === "openrouter") {
    const data = obj["data"];
    if (data && typeof data === "object" && !Array.isArray(data)) return 1;
    return undefined;
  }
  if (provider === "google") {
    const models = obj["models"];
    if (Array.isArray(models)) return models.length;
    return undefined;
  }
  const data = obj["data"];
  if (Array.isArray(data)) return data.length;
  const models = obj["models"];
  if (Array.isArray(models)) return models.length;
  return undefined;
}

export async function checkKey(
  provider: Provider,
  key: string,
): Promise<KeyCheckResult> {
  if (!key || key.trim().length === 0) {
    return { provider, valid: false, error: "empty key" };
  }
  const endpoint = PROVIDER_ENDPOINTS[provider];
  const url = endpoint.url(key);
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...endpoint.auth(key),
  };
  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 200) {
      let body: unknown = undefined;
      try {
        body = await res.json();
      } catch {
        body = undefined;
      }
      return {
        provider,
        valid: true,
        modelCount: countModels(provider, body),
      };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        provider,
        valid: false,
        error: `unauthorized (HTTP ${res.status})`,
      };
    }
    return {
      provider,
      valid: false,
      error: `HTTP ${res.status}`,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { provider, valid: false, error: reason };
  }
}

export async function checkAllConfiguredKeys(): Promise<KeyCheckResult[]> {
  const km = new KeyManager();
  const configured = km.getAvailableProviders();
  if (configured.length === 0) return [];
  const checks = configured.map(async (p) => {
    const key = km.getKey(p);
    if (!key) return { provider: p, valid: false, error: "missing key" };
    return checkKey(p, key);
  });
  return Promise.all(checks);
}
