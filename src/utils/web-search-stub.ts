import { DEFAULT_API_ORIGIN, loadConfig } from "./config.js";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  published?: string | null;
  source?: string;
}

export interface WebSearchCitation {
  index: number;
  title: string;
  url: string;
  snippet: string;
  domain: string;
  source?: string;
}

export interface WebSearchResponse {
  results: WebSearchResult[];
  provider: string;
  cached?: boolean;
  citations?: WebSearchCitation[];
}

const UNAVAILABLE_MESSAGE =
  "Web search requires backend support - see docs/superpowers/specs/2026-05-20-web-search-grounding.md";

function unavailable(): WebSearchResponse {
  console.log(UNAVAILABLE_MESSAGE);
  return { results: [], provider: "unavailable" };
}

function mapResult(value: unknown): WebSearchResult | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (typeof r.title !== "string" || typeof r.url !== "string") return null;
  const snippet = typeof r.snippet === "string" ? r.snippet : "";
  const published =
    typeof r.published === "string" || r.published === null
      ? (r.published as string | null | undefined)
      : undefined;
  const source = typeof r.source === "string" ? r.source : undefined;
  return {
    title: r.title,
    url: r.url,
    snippet,
    published,
    source,
  };
}

function mapCitation(value: unknown): WebSearchCitation | null {
  if (!value || typeof value !== "object") return null;
  const c = value as Record<string, unknown>;
  if (
    typeof c.index !== "number" ||
    typeof c.title !== "string" ||
    typeof c.url !== "string"
  )
    return null;
  return {
    index: c.index,
    title: c.title,
    url: c.url,
    snippet: typeof c.snippet === "string" ? c.snippet : "",
    domain: typeof c.domain === "string" ? c.domain : "",
    source: typeof c.source === "string" ? c.source : undefined,
  };
}

export async function webSearch(
  query: string,
  options: { limit?: number; provider?: string } = {},
): Promise<WebSearchResponse> {
  const config = loadConfig();
  const apiUrl = (config.apiUrl ?? DEFAULT_API_ORIGIN).replace(/\/$/, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

  const payload: Record<string, unknown> = { query };
  if (typeof options.limit === "number") payload.limit = options.limit;
  if (options.provider) payload.provider = options.provider;

  let res: Response;
  try {
    res = await fetch(`${apiUrl}/api/v1/tools/web-search`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return unavailable();
  }

  if (res.status === 404 || res.status === 503) {
    return unavailable();
  }
  if (!res.ok) {
    return unavailable();
  }

  let data: Partial<WebSearchResponse> & {
    results?: unknown;
    citations?: unknown;
  };
  try {
    data = (await res.json()) as Partial<WebSearchResponse> & {
      results?: unknown;
      citations?: unknown;
    };
  } catch {
    return unavailable();
  }

  if (!Array.isArray(data.results)) {
    return { results: [], provider: data.provider ?? "unavailable" };
  }

  const results = data.results
    .map(mapResult)
    .filter((r): r is WebSearchResult => r !== null);

  const citations = Array.isArray(data.citations)
    ? data.citations
        .map(mapCitation)
        .filter((c): c is WebSearchCitation => c !== null)
    : undefined;

  return {
    results,
    provider: data.provider ?? "unknown",
    cached: typeof data.cached === "boolean" ? data.cached : undefined,
    citations,
  };
}
