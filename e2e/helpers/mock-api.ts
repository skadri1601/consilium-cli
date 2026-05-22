import http, { IncomingMessage, ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { URL } from "node:url";

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: { body: string; pathname: string; method: string },
) => void | Promise<void>;

export interface MockApiHandle {
  url: string;
  port: number;
  close(): Promise<void>;
  setRoute(
    method: string,
    pathPattern: string | RegExp,
    handler: RouteHandler,
  ): void;
  /** Cumulative request log for assertions. */
  requests: Array<{ method: string; path: string; body: string }>;
}

interface Route {
  method: string;
  pattern: string | RegExp;
  handler: RouteHandler;
}

function matches(pattern: string | RegExp, pathname: string): boolean {
  if (typeof pattern === "string") return pattern === pathname;
  return pattern.test(pathname);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", () => resolve(""));
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendSseSequence(
  res: ServerResponse,
  events: Array<Record<string, unknown>>,
): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  let i = 0;
  const writeNext = () => {
    if (i >= events.length) {
      res.end();
      return;
    }
    const ev = events[i++];
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
    setImmediate(writeNext);
  };
  writeNext();
}

function defaultDebateStreamEvents(
  debateId: string,
): Array<Record<string, unknown>> {
  return [
    { event: "debate_start", debate_id: debateId },
    { event: "agent_start", agent: "mock-model" },
    { event: "agent_chunk", agent: "mock-model", chunk: "Hello " },
    { event: "agent_chunk", agent: "mock-model", chunk: "world." },
    { event: "agent_complete", agent: "mock-model" },
    {
      event: "consensus",
      consensus: "Mock synthesis: the debate concluded.",
    },
    { event: "done" },
  ];
}

function defaultDeliberationStreamEvents(
  delibId: string,
): Array<Record<string, unknown>> {
  return [
    { event: "deliberation_start", deliberation_id: delibId },
    { event: "phase_change", phase: "proposing" },
    { event: "model_progress", agent: "mock-model", progress: 100 },
    {
      event: "deliberation_complete",
      text: "Mock deliberation synthesis.",
    },
    { event: "done" },
  ];
}

export async function startMockApi(): Promise<MockApiHandle> {
  const routes: Route[] = [];
  const requests: Array<{ method: string; path: string; body: string }> = [];

  routes.push({
    method: "GET",
    pattern: "/health",
    handler: (_req, res) =>
      sendJson(res, 200, { status: "ok", service: "mock-api" }),
  });

  routes.push({
    method: "GET",
    pattern: "/api/v1/auth/me",
    handler: (_req, res) =>
      sendJson(res, 200, {
        id: "user_mock",
        email: "e2e@example.com",
        firstName: "E2E",
        lastName: "Tester",
      }),
  });

  routes.push({
    method: "GET",
    pattern: "/api/v1/users/me",
    handler: (_req, res) =>
      sendJson(res, 200, {
        id: "user_mock",
        email: "e2e@example.com",
        firstName: "E2E",
        lastName: "Tester",
      }),
  });

  routes.push({
    method: "GET",
    pattern: "/api/v1/users/me/preferences",
    handler: (_req, res) =>
      sendJson(res, 200, {
        defaultAgents: ["mock-model"],
        defaultMode: "quick",
      }),
  });

  routes.push({
    method: "POST",
    pattern: "/api/v1/auth/cli-tokens",
    handler: (_req, res, ctx) => {
      let name: string | undefined;
      try {
        const parsed = JSON.parse(ctx.body || "{}");
        name = typeof parsed.name === "string" ? parsed.name : undefined;
      } catch {
        // ignore
      }
      sendJson(res, 201, {
        token: "consilium_mock_ci_token_abcdef123456",
        name: name ?? "ci",
        expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
      });
    },
  });

  routes.push({
    method: "POST",
    pattern: "/api/v1/debates",
    handler: (_req, res) => sendJson(res, 201, { id: "dbt_mock_01" }),
  });

  routes.push({
    method: "GET",
    pattern: /^\/api\/v1\/debates\/[^/]+\/stream$/,
    handler: (req, res) => {
      const debateId = (req.url ?? "").split("/")[4] ?? "dbt_mock_01";
      sendSseSequence(res, defaultDebateStreamEvents(debateId));
    },
  });

  routes.push({
    method: "POST",
    pattern: /^\/api\/v1\/debates\/[^/]+\/cancel$/,
    handler: (_req, res) => sendJson(res, 200, { ok: true }),
  });

  routes.push({
    method: "GET",
    pattern: /^\/api\/v1\/debates(\?.*)?$/,
    handler: (_req, res) => sendJson(res, 200, { items: [] }),
  });

  routes.push({
    method: "POST",
    pattern: "/api/v1/deliberation",
    handler: (_req, res) => sendJson(res, 201, { id: "delib_mock_01" }),
  });

  routes.push({
    method: "GET",
    pattern: /^\/api\/v1\/deliberation\/[^/]+\/stream$/,
    handler: (req, res) => {
      const id = (req.url ?? "").split("/")[4] ?? "delib_mock_01";
      sendSseSequence(res, defaultDeliberationStreamEvents(id));
    },
  });

  routes.push({
    method: "POST",
    pattern: /^\/api\/v1\/sessions\/[^/]+\/share$/,
    handler: (req, res, ctx) => {
      const sessionId = (req.url ?? "").split("/")[4] ?? "sess_mock";
      let isPublic = false;
      try {
        const parsed = JSON.parse(ctx.body || "{}");
        isPublic = parsed.public === true;
      } catch {
        // ignore
      }
      sendJson(res, 201, {
        url: `https://mock.example.com/s/${sessionId}`,
        shareId: sessionId,
        public: isPublic,
        expiresAt: null,
      });
    },
  });

  const server = http.createServer(async (req, res) => {
    const method = (req.method ?? "GET").toUpperCase();
    const rawUrl = req.url ?? "/";
    const parsed = new URL(rawUrl, "http://localhost");
    const pathname = parsed.pathname;
    const body =
      method === "GET" || method === "HEAD" ? "" : await readBody(req);

    requests.push({ method, path: rawUrl, body });

    for (let i = routes.length - 1; i >= 0; i--) {
      const route = routes[i]!;
      if (route.method !== method) continue;
      if (!matches(route.pattern, pathname)) continue;
      try {
        await route.handler(req, res, { body, pathname, method });
      } catch (err) {
        if (!res.headersSent) {
          sendJson(res, 500, {
            error: "mock handler crashed",
            detail: (err as Error).message,
          });
        }
      }
      return;
    }

    sendJson(res, 404, { error: "not found", path: pathname });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  const port = addr.port;
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    port,
    requests,
    setRoute(method, pattern, handler) {
      routes.push({ method: method.toUpperCase(), pattern, handler });
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
