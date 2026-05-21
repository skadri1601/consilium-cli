import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("eventsource", () => ({ default: class {} }));

vi.mock("../utils/config.js", () => ({
  loadConfig: () => ({
    apiUrl: "https://test-api.example.com",
    apiKey: "consilium_testkey123",
    debug: false,
  }),
  DEFAULT_API_ORIGIN: "https://test-api.example.com",
}));

import { ConsiliumClient, ApiError } from "../api/client";

let mockFetch: ReturnType<typeof vi.fn>;

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers(),
  } as Response;
}

function textResponse(body: string, status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(body),
    text: async () => body,
    headers: new Headers(),
  } as Response;
}

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
  vi.stubEnv("CONSILIUM_DEBUG", "");
  vi.stubEnv("CONSILIUM_STREAM_TIMEOUT", "");
  vi.stubEnv("CONSILIUM_STREAM_RETRIES", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("ConsiliumClient constructor", () => {
  it("initializes with config values", () => {
    const client = new ConsiliumClient();
    expect(client.getApiUrl()).toBe("https://test-api.example.com");
  });
});

describe("healthCheck", () => {
  it("returns true on 200", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ status: "ok" }));
    const client = new ConsiliumClient();
    const result = await client.healthCheck();
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://test-api.example.com/health",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns false on non-200", async () => {
    mockFetch.mockResolvedValueOnce(textResponse("Service Unavailable", 503));
    const client = new ConsiliumClient();
    const result = await client.healthCheck();
    expect(result).toBe(false);
  });

  it("returns false on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const client = new ConsiliumClient();
    const result = await client.healthCheck();
    expect(result).toBe(false);
  });

  it("returns false on timeout", async () => {
    const err = new Error("timeout");
    err.name = "AbortError";
    mockFetch.mockRejectedValueOnce(err);
    const client = new ConsiliumClient();
    const result = await client.healthCheck();
    expect(result).toBe(false);
  });
});

describe("createDebate", () => {
  it("sends correct POST body and returns debate id", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: "debate-123" }));
    const client = new ConsiliumClient();
    const result = await client.createDebate({
      topic: "Test topic",
      models: ["gpt-5.4"],
      mode: "council",
    });
    expect(result).toEqual({ id: "debate-123" });
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://test-api.example.com/api/v1/debates");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.topic).toBe("Test topic");
    expect(body.models).toEqual(["gpt-5.4"]);
    expect(body.mode).toBe("council");
    expect(body.debateSource).toBe("cli");
  });

  it("includes Authorization header when apiKey is set", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: "debate-456" }));
    const client = new ConsiliumClient();
    await client.createDebate({ topic: "Auth test" });
    const [, init] = mockFetch.mock.calls[0]!;
    expect(init.headers["Authorization"]).toBe("Bearer consilium_testkey123");
  });

  it("throws ApiError on 401", async () => {
    mockFetch.mockResolvedValueOnce(textResponse("Unauthorized", 401));
    const client = new ConsiliumClient();
    await expect(client.createDebate({ topic: "Fail" })).rejects.toThrow(
      ApiError,
    );
  });

  it("throws ApiError on 403", async () => {
    mockFetch.mockResolvedValueOnce(textResponse("Forbidden", 403));
    const client = new ConsiliumClient();
    await expect(client.createDebate({ topic: "Fail" })).rejects.toThrow(
      ApiError,
    );
  });

  it("throws ApiError on 500", async () => {
    mockFetch.mockResolvedValueOnce(textResponse("Internal Server Error", 500));
    const client = new ConsiliumClient();
    await expect(client.createDebate({ topic: "Fail" })).rejects.toThrow(
      ApiError,
    );
  });

  it("includes projectContext with files", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: "debate-789" }));
    const client = new ConsiliumClient();
    await client.createDebate({
      topic: "With files",
      files: [{ name: "test.ts", content: 'console.log("hello")' }],
    });
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.projectContext.files).toHaveLength(1);
    expect(body.projectContext.files[0].name).toBe("test.ts");
  });

  it("throws on timeout (AbortError)", async () => {
    const err = new Error("timeout");
    err.name = "AbortError";
    mockFetch.mockRejectedValueOnce(err);
    const client = new ConsiliumClient();
    await expect(client.createDebate({ topic: "Timeout" })).rejects.toThrow(
      "Request timed out",
    );
  });
});

describe("listDebates", () => {
  it("sends GET with no params by default", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([]));
    const client = new ConsiliumClient();
    const result = await client.listDebates();
    expect(result).toEqual([]);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://test-api.example.com/api/v1/debates");
    expect(init.method).toBe("GET");
  });

  it("sends correct query params for pagination", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([]));
    const client = new ConsiliumClient();
    await client.listDebates({ limit: 10, offset: 20, search: "test" });
    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toContain("limit=10");
    expect(url).toContain("offset=20");
    expect(url).toContain("search=test");
  });

  it("handles array response", async () => {
    const debates = [
      { id: "1", topic: "A" },
      { id: "2", topic: "B" },
    ];
    mockFetch.mockResolvedValueOnce(jsonResponse(debates));
    const client = new ConsiliumClient();
    const result = await client.listDebates();
    expect(result).toEqual(debates);
  });

  it("handles paginated response with items", async () => {
    const debates = [{ id: "1", topic: "A" }];
    mockFetch.mockResolvedValueOnce(jsonResponse({ items: debates, total: 1 }));
    const client = new ConsiliumClient();
    const result = await client.listDebates();
    expect(result).toEqual(debates);
  });

  it("throws ApiError on failure", async () => {
    mockFetch.mockResolvedValueOnce(textResponse("Server Error", 500));
    const client = new ConsiliumClient();
    await expect(client.listDebates()).rejects.toThrow(ApiError);
  });
});

describe("cancelDebate", () => {
  it("sends POST to cancel endpoint", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 200));
    const client = new ConsiliumClient();
    await client.cancelDebate("debate-abc");
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe(
      "https://test-api.example.com/api/v1/debates/debate-abc/cancel",
    );
    expect(init.method).toBe("POST");
  });

  it("includes Authorization header", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 200));
    const client = new ConsiliumClient();
    await client.cancelDebate("debate-abc");
    const [, init] = mockFetch.mock.calls[0]!;
    expect(init.headers["Authorization"]).toBe("Bearer consilium_testkey123");
  });

  it("throws ApiError on failure", async () => {
    mockFetch.mockResolvedValueOnce(textResponse("Not Found", 404));
    const client = new ConsiliumClient();
    await expect(client.cancelDebate("bad-id")).rejects.toThrow(ApiError);
  });
});

describe("getDebateDetails", () => {
  it("sends GET and returns data", async () => {
    const detail = { id: "debate-xyz", topic: "Details", status: "completed" };
    mockFetch.mockResolvedValueOnce(jsonResponse(detail));
    const client = new ConsiliumClient();
    const result = await client.getDebateDetails("debate-xyz");
    expect(result).toEqual(detail);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://test-api.example.com/api/v1/debates/debate-xyz");
    expect(init.method).toBe("GET");
  });

  it("throws ApiError on 404", async () => {
    mockFetch.mockResolvedValueOnce(textResponse("Not Found", 404));
    const client = new ConsiliumClient();
    await expect(client.getDebateDetails("bad-id")).rejects.toThrow(ApiError);
    try {
      mockFetch.mockResolvedValueOnce(textResponse("Not Found", 404));
      await client.getDebateDetails("bad-id");
    } catch (e) {
      expect((e as ApiError).status).toBe(404);
    }
  });
});

describe("estimateCost", () => {
  it("sends correct payload and returns estimate", async () => {
    const estimate = { totalCost: 0.05, breakdown: [] };
    mockFetch.mockResolvedValueOnce(jsonResponse(estimate));
    const client = new ConsiliumClient();
    const result = await client.estimateCost({
      topic: "Cost test",
      models: ["gpt-5.4", "claude-sonnet-4-6"],
      mode: "council",
    });
    expect(result).toEqual(estimate);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://test-api.example.com/api/v1/debates/estimate");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.topic).toBe("Cost test");
    expect(body.models).toEqual(["gpt-5.4", "claude-sonnet-4-6"]);
    expect(body.mode).toBe("council");
  });

  it("returns null on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce(textResponse("error", 500));
    const client = new ConsiliumClient();
    const result = await client.estimateCost({
      topic: "Fail",
      models: [],
      mode: "quick",
    });
    expect(result).toBeNull();
  });
});

describe("createDeliberation", () => {
  it("sends correct POST body", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: "delib-001" }));
    const client = new ConsiliumClient();
    const result = await client.createDeliberation("Delib topic", {
      mode: "council",
      models: ["gpt-5.4"],
      rounds: 3,
      convergenceThreshold: 0.8,
    });
    expect(result).toEqual({ id: "delib-001" });
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://test-api.example.com/api/v1/deliberation");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.topic).toBe("Delib topic");
    expect(body.mode).toBe("council");
    expect(body.models).toEqual(["gpt-5.4"]);
    expect(body.maxRounds).toBe(3);
    expect(body.convergenceThreshold).toBe(0.8);
    expect(body.debateSource).toBe("cli");
  });

  it("includes context when files are provided", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: "delib-002" }));
    const client = new ConsiliumClient();
    await client.createDeliberation("With files", {
      files: [{ name: "a.ts", content: "code" }],
      projectFiles: [{ path: "/b.ts", content: "more", category: "src" }],
    });
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.context.files).toHaveLength(1);
    expect(body.context.projectFiles).toHaveLength(1);
  });

  it("throws ApiError on failure", async () => {
    mockFetch.mockResolvedValueOnce(textResponse("Bad Request", 400));
    const client = new ConsiliumClient();
    await expect(client.createDeliberation("Fail")).rejects.toThrow(ApiError);
  });
});

describe("createRedTeam", () => {
  it("sends correct POST body", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: "rt-001" }));
    const client = new ConsiliumClient();
    const result = await client.createRedTeam("Vulnerable code", {
      models: ["gpt-5.4"],
      categories: ["injection", "xss"],
    });
    expect(result).toEqual({ id: "rt-001" });
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe(
      "https://test-api.example.com/api/v1/deliberation/red-team",
    );
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.content).toBe("Vulnerable code");
    expect(body.models).toEqual(["gpt-5.4"]);
    expect(body.categories).toEqual(["injection", "xss"]);
  });

  it("throws ApiError on failure", async () => {
    mockFetch.mockResolvedValueOnce(textResponse("Unauthorized", 401));
    const client = new ConsiliumClient();
    await expect(client.createRedTeam("content")).rejects.toThrow(ApiError);
  });
});

describe("getApiUrl", () => {
  it("returns the configured API URL", () => {
    const client = new ConsiliumClient();
    expect(client.getApiUrl()).toBe("https://test-api.example.com");
  });
});
