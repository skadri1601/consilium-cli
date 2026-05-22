import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { eventSourceInstances, FakeEventSource } = vi.hoisted(() => {
  type FakeInit = {
    headers?: Record<string, string>;
    fetch?: (
      url: string,
      init: { headers?: Record<string, string> },
    ) => Promise<Response>;
  };

  const instances: Array<{
    url: string;
    init?: { headers?: Record<string, string> };
    onmessage: ((e: MessageEvent) => void) | null;
    onerror: ((e: Event) => void) | null;
    close: () => void;
  }> = [];

  class FakeEventSource {
    url: string;
    init?: { headers?: Record<string, string> };
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    constructor(url: string, init?: FakeInit) {
      this.url = url;
      const captured: Record<string, string> = {};
      if (init?.headers) Object.assign(captured, init.headers);
      if (init?.fetch) {
        const sniffer = {
          headers: {},
        } as { headers: Record<string, string> };
        const originalFetch = globalThis.fetch;
        globalThis.fetch = ((_u: unknown, i: RequestInit) => {
          Object.assign(sniffer.headers, i?.headers ?? {});
          return Promise.resolve(new Response(""));
        }) as typeof fetch;
        try {
          void init.fetch(url, { headers: {} });
        } finally {
          globalThis.fetch = originalFetch;
        }
        Object.assign(captured, sniffer.headers);
      }
      this.init = { headers: captured };
      instances.push(this);
    }
    close() {}
  }

  return { eventSourceInstances: instances, FakeEventSource };
});

vi.mock("eventsource", () => ({
  default: FakeEventSource,
  EventSource: FakeEventSource,
}));

vi.mock("../utils/config", () => ({
  loadConfig: () => ({ apiUrl: "http://test", apiKey: "consilium_x" }),
  DEFAULT_API_ORIGIN: "http://test",
}));

import { ConsiliumClient, StreamError, ApiError } from "../api/client";

describe("ConsiliumClient.runStreamWithReconnect (via streamDebate)", () => {
  beforeEach(() => {
    eventSourceInstances.length = 0;
    process.env.CONSILIUM_STREAM_TIMEOUT = "10000";
    process.env.CONSILIUM_STREAM_RETRIES = "2";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves when a done event arrives", async () => {
    const client = new ConsiliumClient();
    const events: unknown[] = [];
    const promise = client.streamDebate("dbt_1", (e) => events.push(e));
    await Promise.resolve();
    const es = eventSourceInstances[0]!;
    es.onmessage?.({
      data: JSON.stringify({ event: "agent_chunk", chunk: "hi" }),
      lastEventId: "1",
    } as MessageEvent);
    es.onmessage?.({
      data: JSON.stringify({ event: "done" }),
      lastEventId: "2",
    } as MessageEvent);
    await expect(promise).resolves.toBeUndefined();
    expect(events.length).toBe(2);
  });

  it("sends Last-Event-ID on reconnect after transient drop", async () => {
    const client = new ConsiliumClient();
    const promise = client.streamDebate("dbt_1", () => undefined);
    await Promise.resolve();

    const first = eventSourceInstances[0]!;
    first.onmessage?.({
      data: JSON.stringify({ event: "agent_chunk" }),
      lastEventId: "42",
    } as MessageEvent);
    first.onerror?.({} as Event);

    await new Promise((r) => setTimeout(r, 1100));
    const second = eventSourceInstances[1];
    expect(second).toBeDefined();
    expect(second!.init?.headers?.["Last-Event-ID"]).toBe("42");

    second!.onmessage?.({
      data: JSON.stringify({ event: "done" }),
    } as MessageEvent);
    await expect(promise).resolves.toBeUndefined();
  });

  it("does not retry on fatal 401 status", async () => {
    const client = new ConsiliumClient();
    const promise = client
      .streamDebate("dbt_1", () => undefined)
      .catch((e) => e);
    await Promise.resolve();

    const first = eventSourceInstances[0]!;
    const errWithStatus = {} as Event & { status?: number };
    (errWithStatus as { status?: number }).status = 401;
    first.onerror?.(errWithStatus);

    const err = await promise;
    expect(err).toBeInstanceOf(StreamError);
    expect((err as StreamError).kind).toBe("fatal");
    expect(eventSourceInstances.length).toBe(1);
  });
});

describe("ApiError", () => {
  it("exposes status and body", () => {
    const e = new ApiError(503, "down");
    expect(e.status).toBe(503);
    expect(e.body).toBe("down");
    expect(e.message).toContain("503");
  });
});
