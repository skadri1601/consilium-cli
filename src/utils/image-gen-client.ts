import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { DEFAULT_API_ORIGIN, loadConfig } from "./config.js";

export type ImageSize =
  | "256x256"
  | "512x512"
  | "1024x1024"
  | "1792x1024"
  | "1024x1792";

export type ImageQuality = "standard" | "hd";

export interface ImageGenOptions {
  prompt: string;
  size?: ImageSize;
  quality?: ImageQuality;
  provider?: string;
  outputDir?: string;
}

export interface ImageGenResult {
  filePath: string;
  url: string | null;
  width: number;
  height: number;
  revisedPrompt: string | null;
  provider: string;
  costUsd: number | null;
}

export class ImageGenError extends Error {
  readonly provider: string;
  readonly status: number;

  constructor(message: string, provider: string, status: number) {
    super(message);
    this.provider = provider;
    this.status = status;
  }
}

export const DEFAULT_OUTPUT_DIR = path.join(
  os.homedir(),
  ".consilium",
  "generated",
);

function slugify(prompt: string, wordLimit = 6): string {
  const trimmed = prompt.trim().toLowerCase();
  if (!trimmed) return "image";
  const words = trimmed
    .split(/\s+/)
    .slice(0, wordLimit)
    .join("-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return words.length > 0 ? words : "image";
}

function timestampForFilename(now: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    now.getUTCFullYear().toString() +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    "T" +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes()) +
    pad(now.getUTCSeconds())
  );
}

export function buildOutputPath(
  outputDir: string,
  prompt: string,
  now: Date = new Date(),
): string {
  const slug = slugify(prompt);
  const ts = timestampForFilename(now);
  return path.join(outputDir, `${ts}-${slug}.png`);
}

interface ApiResponse {
  url?: string | null;
  base64?: string | null;
  width?: number;
  height?: number;
  revised_prompt?: string | null;
  provider?: string;
  cost_usd?: number | null;
}

interface ApiError {
  error?: string;
  provider?: string;
  message?: string;
}

async function downloadUrl(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) {
    throw new ImageGenError(
      `Failed to download image from ${url} (HTTP ${res.status})`,
      "download",
      res.status,
    );
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

export async function generateImage(
  opts: ImageGenOptions,
): Promise<ImageGenResult> {
  if (!opts.prompt || !opts.prompt.trim()) {
    throw new ImageGenError("prompt must not be empty", "client", 400);
  }
  const config = loadConfig();
  const apiUrl = (config.apiUrl ?? DEFAULT_API_ORIGIN).replace(/\/$/, "");
  const outputDir = opts.outputDir ?? DEFAULT_OUTPUT_DIR;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

  const body: Record<string, unknown> = {
    prompt: opts.prompt,
    size: opts.size ?? "1024x1024",
    quality: opts.quality ?? "standard",
  };
  if (opts.provider) body["provider"] = opts.provider;

  let res: Response;
  try {
    res = await fetch(`${apiUrl}/api/v1/tools/image-gen`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
  } catch (err) {
    throw new ImageGenError(
      `Image generation request failed: ${(err as Error).message}`,
      opts.provider ?? "unknown",
      0,
    );
  }

  if (!res.ok) {
    let errBody: ApiError = {};
    try {
      errBody = (await res.json()) as ApiError;
    } catch {
      // ignore
    }
    throw new ImageGenError(
      errBody.message ?? `Image generation failed with status ${res.status}`,
      errBody.provider ?? opts.provider ?? "unknown",
      res.status,
    );
  }

  const data = (await res.json()) as ApiResponse;
  if (!data.url && !data.base64) {
    throw new ImageGenError(
      "Image gen response missing url and base64",
      data.provider ?? "unknown",
      502,
    );
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const filePath = buildOutputPath(outputDir, opts.prompt);

  let bytes: Buffer;
  if (data.url) {
    bytes = await downloadUrl(data.url);
  } else {
    bytes = Buffer.from(data.base64 ?? "", "base64");
  }
  fs.writeFileSync(filePath, bytes);

  return {
    filePath,
    url: data.url ?? null,
    width: data.width ?? 1024,
    height: data.height ?? 1024,
    revisedPrompt: data.revised_prompt ?? null,
    provider: data.provider ?? "unknown",
    costUsd: data.cost_usd ?? null,
  };
}
