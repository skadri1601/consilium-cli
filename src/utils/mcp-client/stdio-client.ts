import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import {
  McpClientError,
  McpServerConfig,
  McpTool,
  McpToolResult,
} from "./types";

const PROTOCOL_VERSION = "2025-03-26";
const CLIENT_INFO = { name: "@myconsilium/cli", version: "0.3.0" };

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export interface StdioClientOptions {
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
}

export class StdioMcpClient {
  private readonly config: McpServerConfig;
  private readonly opts: Required<StdioClientOptions>;
  private process: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private buffer = "";
  private pending = new Map<string | number, PendingRequest>();
  private initialized = false;
  private closing = false;
  private stderrChunks: string[] = [];

  constructor(config: McpServerConfig, opts: StdioClientOptions = {}) {
    this.config = config;
    this.opts = {
      startupTimeoutMs: opts.startupTimeoutMs ?? 5000,
      requestTimeoutMs: opts.requestTimeoutMs ?? 30000,
    };
  }

  get name(): string {
    return this.config.name;
  }

  async start(): Promise<void> {
    if (this.process) return;
    const proc = spawn(this.config.command, this.config.args ?? [], {
      env: { ...process.env, ...(this.config.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process = proc;

    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => this.handleStdout(chunk));
    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk: string) => {
      this.stderrChunks.push(chunk);
      if (this.stderrChunks.length > 50) this.stderrChunks.shift();
    });
    proc.on("exit", (code, signal) => this.handleExit(code, signal));
    proc.on("error", (err) => this.rejectAllPending(err));

    await this.initialize();
  }

  async listTools(): Promise<McpTool[]> {
    this.ensureReady();
    const result = (await this.request("tools/list", {})) as {
      tools?: unknown;
    };
    const tools = Array.isArray(result.tools)
      ? (result.tools as McpTool[])
      : [];
    return tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> {
    this.ensureReady();
    const result = (await this.request("tools/call", {
      name,
      arguments: args,
    })) as McpToolResult;
    return result;
  }

  async stop(): Promise<void> {
    if (!this.process || this.closing) return;
    this.closing = true;
    try {
      this.process.stdin.end();
    } catch {
      /* already closed */
    }
    await new Promise<void>((resolve) => {
      if (!this.process) return resolve();
      const t = setTimeout(() => {
        try {
          this.process?.kill("SIGTERM");
        } catch {
          /* already dead */
        }
        resolve();
      }, 1000);
      this.process.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
    this.process = null;
  }

  getStderr(): string {
    return this.stderrChunks.join("");
  }

  private async initialize(): Promise<void> {
    const result = (await this.request(
      "initialize",
      {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: CLIENT_INFO,
        capabilities: {},
      },
      this.opts.startupTimeoutMs,
    )) as { protocolVersion?: string };
    if (!result || typeof result !== "object") {
      throw new McpClientError(
        this.config.name,
        "initialize returned no result",
      );
    }
    this.initialized = true;
    this.sendNotification("notifications/initialized", {});
  }

  private ensureReady(): void {
    if (!this.initialized) {
      throw new McpClientError(this.config.name, "client not initialized");
    }
    if (!this.process || this.process.exitCode !== null) {
      throw new McpClientError(
        this.config.name,
        "server process is not running",
      );
    }
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<unknown> {
    if (!this.process) {
      return Promise.reject(
        new McpClientError(this.config.name, "process not started"),
      );
    }
    const id = this.nextId++;
    const payload =
      JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    const effectiveTimeout = timeoutMs ?? this.opts.requestTimeoutMs;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new McpClientError(
            this.config.name,
            `${method} timed out after ${effectiveTimeout}ms`,
          ),
        );
      }, effectiveTimeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.process!.stdin.write(payload);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new McpClientError(this.config.name, (err as Error).message));
      }
    });
  }

  private sendNotification(
    method: string,
    params: Record<string, unknown>,
  ): void {
    if (!this.process) return;
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n";
    try {
      this.process.stdin.write(payload);
    } catch {
      /* server may have exited */
    }
  }

  private handleStdout(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const idx = this.buffer.indexOf("\n");
      if (idx === -1) break;
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as {
          id?: string | number;
          result?: unknown;
          error?: { code?: number; message?: string };
        };
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const { resolve, reject, timer } = this.pending.get(msg.id)!;
          clearTimeout(timer);
          this.pending.delete(msg.id);
          if (msg.error) {
            reject(
              new McpClientError(
                this.config.name,
                msg.error.message ?? "protocol error",
                msg.error.code,
              ),
            );
          } else {
            resolve(msg.result);
          }
        }
      } catch {
        /* ignore malformed line */
      }
    }
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    const reason = signal ? `signal ${signal}` : `exit code ${code}`;
    const err = new McpClientError(
      this.config.name,
      `server process exited (${reason})${this.stderrChunks.length ? `: ${this.getStderr().slice(-200)}` : ""}`,
    );
    this.rejectAllPending(err);
    this.process = null;
    this.initialized = false;
  }

  private rejectAllPending(err: Error): void {
    for (const [id, { reject, timer }] of this.pending) {
      clearTimeout(timer);
      reject(err);
      this.pending.delete(id);
    }
  }
}
