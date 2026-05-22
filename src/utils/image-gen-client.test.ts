import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockLoadConfig, mockMkdirSync, mockWriteFileSync } = vi.hoisted(() => ({
  mockLoadConfig: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
}));

vi.mock("./config", () => ({
  loadConfig: mockLoadConfig,
  DEFAULT_API_ORIGIN: "https://api.myconsilium.xyz",
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    default: {
      ...actual,
      mkdirSync: mockMkdirSync,
      writeFileSync: mockWriteFileSync,
    },
    mkdirSync: mockMkdirSync,
    writeFileSync: mockWriteFileSync,
  };
});

import {
  buildOutputPath,
  generateImage,
  ImageGenError,
  DEFAULT_OUTPUT_DIR,
} from "./image-gen-client";

let originalFetch: typeof fetch;

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadConfig.mockReturnValue({
    apiUrl: "https://api.test.example",
    apiKey: "test-key",
  });
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("buildOutputPath", () => {
  it("generates a timestamped path with prompt slug", () => {
    const fixedDate = new Date(Date.UTC(2026, 4, 20, 14, 5, 9));
    const out = buildOutputPath(
      "/tmp/out",
      "A pleasant sunrise over a mountain lake at dawn",
      fixedDate,
    );
    expect(out).toBe(
      "/tmp/out/20260520T140509-a-pleasant-sunrise-over-a-mountain.png",
    );
  });

  it("falls back to a generic slug when prompt is empty", () => {
    const fixedDate = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    const out = buildOutputPath("/tmp", "   ", fixedDate);
    expect(out).toBe("/tmp/20260101T000000-image.png");
  });
});

describe("generateImage", () => {
  it("downloads URL response and writes file", async () => {
    let postCallsCaptured: { url: string; init?: RequestInit }[] = [];
    let fetchCallCount = 0;

    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      fetchCallCount++;
      postCallsCaptured.push({ url: String(url), init });
      if (fetchCallCount === 1) {
        return new Response(
          JSON.stringify({
            url: "https://cdn.example/img.png",
            base64: null,
            width: 1024,
            height: 1024,
            revised_prompt: "A revised prompt.",
            provider: "openai",
            cost_usd: 0.04,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      return new Response(new Uint8Array([1, 2, 3, 4]).buffer, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    }) as unknown as typeof fetch;

    const result = await generateImage({
      prompt: "a cat on a hill",
      outputDir: "/tmp/gen",
    });

    expect(postCallsCaptured[0]?.url).toBe(
      "https://api.test.example/api/v1/tools/image-gen",
    );
    const init = postCallsCaptured[0]?.init as
      | { headers?: Record<string, string>; body?: string }
      | undefined;
    expect(init?.headers?.Authorization).toBe("Bearer test-key");
    const sentBody = JSON.parse(init?.body ?? "{}");
    expect(sentBody.prompt).toBe("a cat on a hill");
    expect(sentBody.size).toBe("1024x1024");
    expect(sentBody.quality).toBe("standard");

    expect(result.provider).toBe("openai");
    expect(result.url).toBe("https://cdn.example/img.png");
    expect(result.width).toBe(1024);
    expect(result.height).toBe(1024);
    expect(result.revisedPrompt).toBe("A revised prompt.");
    expect(result.costUsd).toBe(0.04);
    expect(result.filePath.startsWith("/tmp/gen/")).toBe(true);
    expect(result.filePath.endsWith(".png")).toBe(true);
    expect(mockMkdirSync).toHaveBeenCalledWith("/tmp/gen", { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
  });

  it("decodes base64 response when no URL is present", async () => {
    const base64 = Buffer.from("hello-bytes").toString("base64");

    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            url: null,
            base64,
            width: 512,
            height: 512,
            revised_prompt: null,
            provider: "xai",
            cost_usd: null,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    ) as unknown as typeof fetch;

    const result = await generateImage({
      prompt: "fox in snow",
      outputDir: "/tmp/gen",
      size: "512x512",
      provider: "xai",
    });

    expect(result.url).toBeNull();
    expect(result.provider).toBe("xai");
    expect(result.revisedPrompt).toBeNull();
    expect(result.costUsd).toBeNull();
    expect(result.width).toBe(512);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const [, payload] = (mockWriteFileSync.mock.calls[0] ?? []) as [
      string,
      Buffer,
    ];
    expect(Buffer.isBuffer(payload)).toBe(true);
    expect(payload.toString()).toBe("hello-bytes");
  });

  it("throws ImageGenError on 503 with structured body", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: "provider_unavailable",
            provider: "openai",
            message: "OPENAI_API_KEY not configured",
          }),
          {
            status: 503,
            headers: { "Content-Type": "application/json" },
          },
        ),
    ) as unknown as typeof fetch;

    await expect(
      generateImage({ prompt: "x", outputDir: "/tmp/gen" }),
    ).rejects.toMatchObject({
      provider: "openai",
      status: 503,
    });
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("throws ImageGenError when prompt is empty", async () => {
    await expect(generateImage({ prompt: "   " })).rejects.toBeInstanceOf(
      ImageGenError,
    );
  });

  it("throws ImageGenError when fetch itself rejects", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(generateImage({ prompt: "x" })).rejects.toBeInstanceOf(
      ImageGenError,
    );
  });

  it("throws when response is OK but missing url and base64", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ url: null, base64: null, provider: "openai" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    ) as unknown as typeof fetch;

    await expect(generateImage({ prompt: "x" })).rejects.toBeInstanceOf(
      ImageGenError,
    );
  });

  it("uses DEFAULT_OUTPUT_DIR when not specified", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            base64: Buffer.from("xx").toString("base64"),
            width: 1024,
            height: 1024,
            provider: "openai",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    ) as unknown as typeof fetch;

    await generateImage({ prompt: "default dir test" });
    expect(mockMkdirSync).toHaveBeenCalledWith(DEFAULT_OUTPUT_DIR, {
      recursive: true,
    });
  });

  it("omits Authorization header when no API key is configured", async () => {
    mockLoadConfig.mockReturnValue({ apiUrl: "https://api.test.example" });
    const spy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            base64: Buffer.from("a").toString("base64"),
            width: 1024,
            height: 1024,
            provider: "openai",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    );
    globalThis.fetch = spy as unknown as typeof fetch;

    await generateImage({ prompt: "no auth", outputDir: "/tmp/g" });
    const calls = spy.mock.calls as unknown as Array<unknown[]>;
    const init = calls[0]?.[1] as
      | { headers?: Record<string, string> }
      | undefined;
    expect(init?.headers?.Authorization).toBeUndefined();
  });

  it("passes provider option through when supplied", async () => {
    const spy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            base64: Buffer.from("a").toString("base64"),
            width: 1024,
            height: 1024,
            provider: "stability",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    );
    globalThis.fetch = spy as unknown as typeof fetch;

    await generateImage({
      prompt: "x",
      outputDir: "/tmp/g",
      provider: "stability",
      quality: "hd",
      size: "1792x1024",
    });
    const calls = spy.mock.calls as unknown as Array<unknown[]>;
    const init = calls[0]?.[1] as { body?: string } | undefined;
    const sent = JSON.parse(init?.body ?? "{}");
    expect(sent.provider).toBe("stability");
    expect(sent.quality).toBe("hd");
    expect(sent.size).toBe("1792x1024");
  });
});
