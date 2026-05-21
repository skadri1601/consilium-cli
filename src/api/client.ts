import EventSource from "eventsource";
import { DEFAULT_API_ORIGIN, loadConfig } from "../utils/config";

export interface ToolSchema {
  qualifiedName: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolBudget {
  maxCallsPerTurn?: number;
  maxTotalCalls?: number;
  perCallTimeoutMs?: number;
}

export interface ToolResult {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  isError?: boolean;
}

export interface DebateOptions {
  topic: string;
  models?: string[];
  mode?:
    | "quick"
    | "council"
    | "deep"
    | "blind"
    | "redteam"
    | "jury"
    | "market"
    | "auto";
  conversationId?: string;
  files?: Array<{ name: string; content: string }>;
  images?: Array<{ name: string; base64: string }>;
  projectFiles?: Array<{ path: string; content: string; category: string }>;
  projectContext?: Record<string, unknown>;
  debateSource?: "web" | "cli" | "mcp";
  tools?: ToolSchema[];
  toolBudget?: ToolBudget;
}

export interface DeliberationOptions {
  models?: string[];
  mode?: string;
  rounds?: number;
  convergenceThreshold?: number;
  responses?: Record<string, unknown>;
  files?: Array<{ name: string; content: string }>;
  projectFiles?: Array<{ path: string; content: string; category: string }>;
  projectContext?: Record<string, unknown>;
  debateSource?: "web" | "cli" | "mcp" | "deliberation";
  tools?: ToolSchema[];
  toolBudget?: ToolBudget;
}

export interface RedTeamOptions {
  content: string;
  models?: string[];
  categories?: string[];
}

export interface RoutingFallbackResolution {
  requested_model: string;
  requested_provider?: string | null;
  effective_model: string;
  effective_provider: string;
  is_fallback: boolean;
  fallback_reason?: string | null;
}

export interface DeliberationEvent {
  type:
    | "deliberation_start"
    | "phase_change"
    | "model_progress"
    | "convergence_update"
    | "dissent_detected"
    | "vote_cast"
    | "cost_update"
    | "deliberation_complete"
    | "done"
    | "error"
    | "tool:call_request"
    | "tool:call_completed"
    | "tool:call_failed"
    | "routing:tools_available"
    | "routing:fallback";
  phase?: string;
  agent?: string;
  text?: string;
  error?: string;
  deliberationId?: string;
  progress?: number;
  convergence?: number;
  dissent?: { agent: string; reason: string };
  vote?: { agent: string; position: string; confidence: number };
  cost?: { model: string; tokens: number; cost: number };
  callId?: string;
  seat?: string;
  round?: number;
  name?: string;
  arguments?: Record<string, unknown>;
  durationMs?: number;
  bytes?: number;
  reason?: string;
  toolCount?: number;
  message?: string;
  resolutions?: RoutingFallbackResolution[];
}

export interface DebateEvent {
  type:
    | "debate_start"
    | "agent_start"
    | "agent_chunk"
    | "agent_complete"
    | "consensus"
    | "done"
    | "error"
    | "debate:cancelled"
    | "tool:call_request"
    | "tool:call_completed"
    | "tool:call_failed";
  agent?: string;
  text?: string;
  error?: string;
  debateId?: string;
  callId?: string;
  seat?: string;
  round?: number;
  name?: string;
  arguments?: Record<string, unknown>;
  durationMs?: number;
  bytes?: number;
  reason?: string;
}

export interface DebateSummary {
  id: string;
  topic?: string;
  mode?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  models?: string[];
  conversationId?: string | null;
}

const RECONNECT_BACKOFFS_MS = [1000, 2000, 4000];

type StreamErrorKind = "transient" | "fatal" | "timeout";

export class StreamError extends Error {
  readonly kind: StreamErrorKind;
  readonly httpStatus?: number;
  constructor(message: string, kind: StreamErrorKind, httpStatus?: number) {
    super(message);
    this.name = "StreamError";
    this.kind = kind;
    this.httpStatus = httpStatus;
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string, message?: string) {
    super(message ?? `HTTP ${status}: ${body}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ConsiliumClient {
  private readonly apiUrl: string;
  private readonly apiKey?: string;
  private readonly debug: boolean;
  private readonly streamTimeout: number;
  private readonly maxReconnectAttempts: number;

  constructor() {
    const config = loadConfig();
    this.apiUrl = config.apiUrl || DEFAULT_API_ORIGIN;
    this.apiKey = config.apiKey;
    this.debug =
      config.debug === true ||
      process.env.CONSILIUM_DEBUG === "1" ||
      process.env.CONSILIUM_DEBUG === "true";
    this.streamTimeout = Number.parseInt(
      process.env.CONSILIUM_STREAM_TIMEOUT || "300000",
      10,
    );
    const parsedRetries = Number.parseInt(
      process.env.CONSILIUM_STREAM_RETRIES || "3",
      10,
    );
    this.maxReconnectAttempts =
      Number.isNaN(parsedRetries) || parsedRetries < 0 ? 3 : parsedRetries;
  }

  private log(message: string, data?: any) {
    if (this.debug) {
      console.log(`[DEBUG] ${message}`, data || "");
    }
  }

  private logError(message: string, error: any) {
    console.error(`[ERROR] ${message}`);
    if (error.cause) {
      console.error(
        `[ERROR] Cause: ${error.cause.code || error.cause.message}`,
      );
    }
    console.error(`[ERROR] Details:`, error.message);
  }

  async healthCheck(): Promise<boolean> {
    try {
      this.log("Checking API health...");
      const response = await fetch(`${this.apiUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });

      this.log(`Health check status: ${response.status}`);

      if (!response.ok) {
        this.logError(
          `API health check failed with status ${response.status}`,
          new Error(await response.text()),
        );
        return false;
      }

      const health = await response.json();
      this.log("API is healthy", health);
      return true;
    } catch (error: any) {
      this.logError("Failed to connect to API", error);
      console.error(
        `\nCannot connect to API at ${this.apiUrl}. Is the server running?`,
      );
      return false;
    }
  }

  private getApiKey(): string | undefined {
    return this.apiKey;
  }

  private async runStreamWithReconnect(
    streamUrl: string,
    handleMessage: (data: Record<string, unknown>) => {
      terminal?: boolean;
      error?: string;
    },
    contextLabel: string,
  ): Promise<void> {
    const apiKey = this.getApiKey();
    const buildInit = (
      lastEventId: string | null,
    ): { headers?: Record<string, string> } => {
      const headers: Record<string, string> = {};
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      if (lastEventId) headers["Last-Event-ID"] = lastEventId;
      return Object.keys(headers).length ? { headers } : {};
    };

    let attempt = 0;
    let terminalSeen = false;
    let lastEventId: string | null = null;
    let lastError: Error | null = null;

    while (!terminalSeen && attempt <= this.maxReconnectAttempts) {
      try {
        await new Promise<void>((resolve, reject) => {
          const eventSource = new EventSource(
            streamUrl,
            buildInit(lastEventId),
          );
          let connectionEstablished = false;
          let eventCount = 0;
          const timer = setTimeout(() => {
            eventSource.close();
            reject(
              new StreamError(
                `${contextLabel} stream timeout after ${Math.round(this.streamTimeout / 1000)}s`,
                "timeout",
              ),
            );
          }, this.streamTimeout);

          eventSource.onmessage = (event: MessageEvent) => {
            try {
              if (!connectionEstablished) {
                this.log(
                  `${contextLabel} SSE connection established${lastEventId ? ` (resumed from ${lastEventId})` : ""}`,
                );
                connectionEstablished = true;
              }
              if (event.lastEventId) lastEventId = event.lastEventId;
              const data = JSON.parse(event.data) as Record<string, unknown>;
              eventCount++;
              const outcome = handleMessage(data);
              if (outcome.error) {
                clearTimeout(timer);
                eventSource.close();
                terminalSeen = true;
                reject(new StreamError(outcome.error, "fatal"));
                return;
              }
              if (outcome.terminal) {
                clearTimeout(timer);
                eventSource.close();
                terminalSeen = true;
                resolve();
              }
            } catch (err) {
              this.logError(`${contextLabel} parse error`, err);
            }
          };

          eventSource.onerror = (err: Event) => {
            clearTimeout(timer);
            const status =
              (err as MessageEvent & { status?: number }).status ??
              (eventSource as EventSource & { status?: number }).status;
            eventSource.close();
            const reason = connectionEstablished
              ? `${contextLabel} stream dropped after ${eventCount} events`
              : `${contextLabel} stream failed to connect`;
            // 429 is technically 4xx but is a backpressure signal, not
            // a fatal client error - treat it as transient so the
            // caller's reconnect loop applies backoff instead of
            // surfacing the rate-limit as an immediate failure. All
            // other 4xx codes (401/403/404) remain fatal.
            const kind: StreamErrorKind =
              status === 429
                ? "transient"
                : status !== undefined && status >= 400 && status < 500
                  ? "fatal"
                  : "transient";
            this.log(
              `${reason}${status !== undefined ? ` (status=${status})` : ""}`,
            );
            reject(new StreamError(reason, kind, status));
          };
        });
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (terminalSeen) return;
        if (err instanceof StreamError && err.kind === "fatal") {
          throw lastError;
        }
        if (attempt >= this.maxReconnectAttempts) {
          throw lastError;
        }
        const delay =
          RECONNECT_BACKOFFS_MS[
            Math.min(attempt, RECONNECT_BACKOFFS_MS.length - 1)
          ] ?? 4000;
        console.error(
          `[consilium] ${contextLabel} stream dropped, reconnecting in ${delay}ms (attempt ${attempt + 1}/${this.maxReconnectAttempts})`,
        );
        await sleep(delay);
        attempt++;
        continue;
      }
      return;
    }
    if (!terminalSeen && lastError) throw lastError;
  }

  async createDebate(options: DebateOptions): Promise<{ id: string }> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const apiKey = this.getApiKey();
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const url = `${this.apiUrl}/api/v1/debates`;
    this.log(`Creating debate at: ${url}`);

    try {
      const body: Record<string, any> = {
        topic: options.topic,
        models: options.models || [
          "gpt-5.4-mini",
          "claude-haiku-4-5-20251001",
          "gemini-3-flash-preview",
        ],
      };
      if (options.mode) body.mode = options.mode;
      body.debateSource = options.debateSource ?? "cli";
      if (options.conversationId) body.conversationId = options.conversationId;
      const pc: Record<string, any> = options.projectContext
        ? { ...options.projectContext }
        : {};
      if (options.files?.length)
        pc.files = options.files.map((f: any) => ({
          name: f.name,
          content: f.content.slice(0, 8192),
        }));
      if (options.images?.length) pc.images = options.images;
      if (Object.keys(pc).length > 0) body.projectContext = pc;
      if (options.tools?.length) body.tools = options.tools;
      if (options.toolBudget) body.toolBudget = options.toolBudget;

      if (process.env.CONSILIUM_DEBUG) {
        const fileNames = pc.files?.map((f: any) => f.name) || [];
        this.log(
          `Sending ${fileNames.length} context files, body size: ${JSON.stringify(body).length} bytes`,
        );
        this.log(`First 10 files: ${fileNames.slice(0, 10).join(", ")}`);
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });

      this.log(`Create debate response: ${response.status}`);

      if (!response.ok) {
        const errorBody = await response.text();
        this.logError(
          `Failed to create debate (${response.status})`,
          new Error(errorBody),
        );

        if (response.status === 503) {
          console.error(
            "\nService unavailable. The AI agents backend may be down.",
          );
        }

        throw new ApiError(response.status, errorBody);
      }

      const result = (await response.json()) as { id: string };
      this.log(`Debate created with ID: ${result.id}`);
      return result;
    } catch (error: any) {
      if (error.name === "AbortError") {
        this.logError("Request timeout", error);
        throw new Error("Request timed out - API is not responding");
      }

      if (error.cause?.code === "ECONNREFUSED") {
        this.logError("Connection refused", error);
        console.error(
          `\nCannot connect to API at ${this.apiUrl}. Is the server running?`,
        );
      }

      throw error;
    }
  }

  async streamDebate(
    debateId: string,
    onEvent: (event: DebateEvent) => void,
  ): Promise<void> {
    const streamUrl = `${this.apiUrl}/api/v1/debates/${debateId}/stream`;
    this.log(`Opening SSE stream: ${streamUrl}`);

    return this.runStreamWithReconnect(
      streamUrl,
      (data) => {
        const str = (k: string): string | undefined => {
          const v = data[k];
          return typeof v === "string" ? v : undefined;
        };
        const eventType = str("event") ?? "message";
        const debateEvent: DebateEvent = {
          type: eventType as DebateEvent["type"],
          agent: str("agent") ?? str("agent_id"),
          text:
            str("chunk") ??
            str("consensus") ??
            str("golden_prompt") ??
            str("goldenPrompt") ??
            str("response") ??
            str("content"),
          error: str("error"),
          debateId: str("debate_id") ?? str("debateId"),
        };
        onEvent(debateEvent);

        if (eventType === "done" || eventType === "debate:cancelled") {
          return { terminal: true };
        }
        if (eventType === "error") {
          return { error: str("error") || "Server error" };
        }
        return {};
      },
      "Debate",
    );
  }

  async postToolResult(
    deliberationId: string,
    callId: string,
    result: ToolResult,
  ): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const apiKey = this.getApiKey();
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const response = await fetch(
      `${this.apiUrl}/api/v1/deliberation/${deliberationId}/tool-results`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ callId, result }),
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!response.ok && response.status !== 204) {
      const body = await response.text().catch(() => "");
      throw new ApiError(
        response.status,
        body,
        `tool-result POST failed: HTTP ${response.status}`,
      );
    }
  }

  async cancelDebate(debateId: string): Promise<void> {
    const headers: Record<string, string> = {};
    const apiKey = this.getApiKey();
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const response = await fetch(
      `${this.apiUrl}/api/v1/debates/${debateId}/cancel`,
      {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!response.ok) {
      throw new ApiError(
        response.status,
        await response.text().catch(() => ""),
        `Cancel failed: HTTP ${response.status}`,
      );
    }
  }

  async skipToJudge(debateId: string): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const apiKey = this.getApiKey();
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const response = await fetch(
      `${this.apiUrl}/api/v1/debates/${debateId}/skip`,
      {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!response.ok) {
      throw new ApiError(
        response.status,
        await response.text().catch(() => ""),
        `Skip failed: HTTP ${response.status}`,
      );
    }
  }

  async getDebateDetails(debateId: string): Promise<any> {
    const headers: Record<string, string> = {};
    const apiKey = this.getApiKey();
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const response = await fetch(`${this.apiUrl}/api/v1/debates/${debateId}`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new ApiError(
        response.status,
        await response.text().catch(() => ""),
      );
    }

    return response.json();
  }

  async estimateCost(options: {
    topic: string;
    models: string[];
    mode: string;
  }): Promise<any> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const apiKey = this.getApiKey();
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const response = await fetch(`${this.apiUrl}/api/v1/debates/estimate`, {
      method: "POST",
      headers,
      body: JSON.stringify(options),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;
    return response.json();
  }

  async createDeliberation(
    topic: string,
    options: Partial<DeliberationOptions> = {},
  ): Promise<{ id: string }> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const apiKey = this.getApiKey();
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const url = `${this.apiUrl}/api/v1/deliberation`;
    this.log(`Creating deliberation at: ${url}`);

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        topic,
        mode: options.mode,
        models: options.models,
        maxRounds: options.rounds,
        convergenceThreshold: options.convergenceThreshold,
        responses: options.responses,
        debateSource: options.debateSource ?? "cli",
        ...(options.files?.length || options.projectFiles?.length
          ? {
              context: {
                ...(options.files?.length ? { files: options.files } : {}),
                ...(options.projectFiles?.length
                  ? { projectFiles: options.projectFiles }
                  : {}),
              },
            }
          : {}),
        ...(options.projectContext && {
          projectContext: options.projectContext,
        }),
        ...(options.tools?.length ? { tools: options.tools } : {}),
        ...(options.toolBudget ? { toolBudget: options.toolBudget } : {}),
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new ApiError(response.status, errorBody);
    }

    return (await response.json()) as { id: string };
  }

  async createBenchmark(payload: {
    benchmark: string;
    models: string[];
    mode: string;
    n?: number;
  }): Promise<{ id: string }> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const apiKey = this.getApiKey();
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const url = `${this.apiUrl}/api/v1/deliberation/benchmarks`;
    this.log(`Creating benchmark at: ${url}`);

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new ApiError(response.status, errorBody);
    }

    return (await response.json()) as { id: string };
  }

  async streamDeliberation(
    id: string,
    onEvent: (event: DeliberationEvent) => void,
  ): Promise<void> {
    const streamUrl = `${this.apiUrl}/api/v1/deliberation/${id}/stream`;
    this.log(`Opening deliberation stream: ${streamUrl}`);

    return this.runStreamWithReconnect(
      streamUrl,
      (data) => {
        const str = (k: string): string | undefined => {
          const v = data[k];
          return typeof v === "string" ? v : undefined;
        };
        const num = (k: string): number | undefined => {
          const v = data[k];
          return typeof v === "number" ? v : undefined;
        };
        const eventType = str("event") ?? "message";
        const deliberationEvent: DeliberationEvent = {
          type: eventType as DeliberationEvent["type"],
          phase: str("phase"),
          agent: str("agent") ?? str("agent_id"),
          text:
            str("chunk") ?? str("text") ?? str("content") ?? str("response"),
          error: str("error"),
          deliberationId: str("deliberation_id") ?? str("deliberationId"),
          progress: num("progress"),
          convergence: num("convergence"),
          dissent: data["dissent"] as DeliberationEvent["dissent"],
          vote: data["vote"] as DeliberationEvent["vote"],
          cost: data["cost"] as DeliberationEvent["cost"],
          message: str("message"),
          resolutions: data["resolutions"] as
            | RoutingFallbackResolution[]
            | undefined,
        };
        onEvent(deliberationEvent);

        if (eventType === "done" || eventType === "deliberation_complete") {
          return { terminal: true };
        }
        if (eventType === "error") {
          return { error: str("error") || "Deliberation error" };
        }
        return {};
      },
      "Deliberation",
    );
  }

  async streamBenchmark(
    id: string,
    onEvent: (event: DeliberationEvent) => void,
  ): Promise<void> {
    const streamUrl = `${this.apiUrl}/api/v1/deliberation/benchmarks/${id}/stream`;
    this.log(`Opening benchmark stream: ${streamUrl}`);

    return this.runStreamWithReconnect(
      streamUrl,
      (data) => {
        const eventType = (data["event"] as string | undefined) ?? "message";
        const deliberationEvent: DeliberationEvent = {
          type: eventType as DeliberationEvent["type"],
          phase: data["phase"] as string | undefined,
          agent:
            (data["agent"] as string | undefined) ??
            (data["agent_id"] as string | undefined),
          text:
            (data["chunk"] as string | undefined) ??
            (data["text"] as string | undefined) ??
            (data["content"] as string | undefined) ??
            (data["response"] as string | undefined),
          error: data["error"] as string | undefined,
          deliberationId:
            (data["deliberation_id"] as string | undefined) ??
            (data["deliberationId"] as string | undefined) ??
            (data["benchmark_id"] as string | undefined) ??
            (data["benchmarkId"] as string | undefined),
          progress: data["progress"] as number | undefined,
          convergence: data["convergence"] as number | undefined,
          dissent: data["dissent"] as DeliberationEvent["dissent"],
          vote: data["vote"] as DeliberationEvent["vote"],
          cost: data["cost"] as DeliberationEvent["cost"],
        };
        onEvent(deliberationEvent);

        if (eventType === "done" || eventType === "deliberation_complete") {
          return { terminal: true };
        }
        if (eventType === "error") {
          return {
            error: (data["error"] as string | undefined) || "Benchmark error",
          };
        }
        return {};
      },
      "Benchmark",
    );
  }

  async listDebates(
    opts: { limit?: number; offset?: number; search?: string } = {},
  ): Promise<DebateSummary[]> {
    const headers: Record<string, string> = {};
    const apiKey = this.getApiKey();
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const params = new URLSearchParams();
    if (opts.limit !== undefined) params.set("limit", String(opts.limit));
    if (opts.offset !== undefined) params.set("offset", String(opts.offset));
    if (opts.search) params.set("search", opts.search);
    const qs = params.toString();
    const url = `${this.apiUrl}/api/v1/debates${qs ? `?${qs}` : ""}`;

    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new ApiError(
        response.status,
        await response.text().catch(() => ""),
      );
    }

    const data = await response.json();
    if (Array.isArray(data)) return data as DebateSummary[];
    if (Array.isArray((data as { items?: unknown[] }).items))
      return (data as { items: DebateSummary[] }).items;
    return [];
  }

  async cancelDeliberation(deliberationId: string): Promise<void> {
    const headers: Record<string, string> = {};
    const apiKey = this.getApiKey();
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const response = await fetch(
      `${this.apiUrl}/api/v1/deliberation/${deliberationId}/cancel`,
      {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!response.ok) {
      throw new ApiError(
        response.status,
        await response.text().catch(() => ""),
        `Cancel failed: HTTP ${response.status}`,
      );
    }
  }

  async createRedTeam(
    content: string,
    options: Partial<RedTeamOptions> = {},
  ): Promise<{ id: string }> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const apiKey = this.getApiKey();
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const url = `${this.apiUrl}/api/v1/deliberation/red-team`;
    this.log(`Creating red team assessment at: ${url}`);

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ content, ...options }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new ApiError(response.status, errorBody);
    }

    return (await response.json()) as { id: string };
  }

  getApiUrl(): string {
    return this.apiUrl;
  }
}
