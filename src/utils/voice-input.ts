import fs from "node:fs";
import path from "node:path";
import { DEFAULT_API_ORIGIN, loadConfig } from "./config.js";
import { KeyManager } from "./key-manager.js";

export interface TranscribeOptions {
  language?: string;
  audioPath: string;
}

export interface TranscriptResult {
  text: string;
  durationMs: number;
  cost?: number;
}

export class VoiceTranscriptionError extends Error {
  readonly code:
    | "missing_key"
    | "backend_unavailable"
    | "openai_error"
    | "file_missing"
    | "network";
  constructor(message: string, code: VoiceTranscriptionError["code"]) {
    super(message);
    this.code = code;
    this.name = "VoiceTranscriptionError";
  }
}

const OPENAI_WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";
const WHISPER_PER_MINUTE_USD = 0.006;

function buildMultipart(
  fields: Record<string, string>,
  file: { name: string; contentType: string; data: Buffer },
): { body: Buffer; contentType: string } {
  const boundary = `----consilium-voice-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  const chunks: Buffer[] = [];

  for (const [key, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(
      Buffer.from(`Content-Disposition: form-data; name="${key}"\r\n\r\n`),
    );
    chunks.push(Buffer.from(`${value}\r\n`));
  }

  chunks.push(Buffer.from(`--${boundary}\r\n`));
  chunks.push(
    Buffer.from(
      `Content-Disposition: form-data; name="file"; filename="${file.name}"\r\n`,
    ),
  );
  chunks.push(Buffer.from(`Content-Type: ${file.contentType}\r\n\r\n`));
  chunks.push(file.data);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function getOpenAIKey(): string | undefined {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    const km = new KeyManager();
    return km.getKey("openai");
  } catch {
    return undefined;
  }
}

interface WhisperJSON {
  text?: string;
  duration?: number;
  error?: { message?: string };
}

async function transcribeViaOpenAI(
  audioPath: string,
  language: string,
  apiKey: string,
): Promise<TranscriptResult> {
  const data = fs.readFileSync(audioPath);
  const { body, contentType } = buildMultipart(
    { model: "whisper-1", language, response_format: "json" },
    {
      name: path.basename(audioPath),
      contentType: "audio/wav",
      data,
    },
  );

  const start = Date.now();
  let res: Response;
  try {
    res = await fetch(OPENAI_WHISPER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": contentType,
      },
      body,
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    throw new VoiceTranscriptionError(
      `Whisper request failed: ${(err as Error).message}`,
      "network",
    );
  }
  const durationMs = Date.now() - start;

  let payload: WhisperJSON;
  try {
    payload = (await res.json()) as WhisperJSON;
  } catch {
    throw new VoiceTranscriptionError(
      `Whisper returned non-JSON response (HTTP ${res.status})`,
      "openai_error",
    );
  }

  if (!res.ok) {
    const msg = payload?.error?.message ?? `HTTP ${res.status}`;
    throw new VoiceTranscriptionError(`Whisper error: ${msg}`, "openai_error");
  }
  if (typeof payload.text !== "string") {
    throw new VoiceTranscriptionError(
      "Whisper response missing 'text' field",
      "openai_error",
    );
  }

  const cost =
    typeof payload.duration === "number"
      ? (payload.duration / 60) * WHISPER_PER_MINUTE_USD
      : undefined;
  return { text: payload.text.trim(), durationMs, cost };
}

async function transcribeViaConsiliumBackend(
  audioPath: string,
  language: string,
): Promise<TranscriptResult> {
  const config = loadConfig();
  const apiUrl = (config.apiUrl ?? DEFAULT_API_ORIGIN).replace(/\/$/, "");
  const headers: Record<string, string> = {};
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

  const data = fs.readFileSync(audioPath);
  const { body, contentType } = buildMultipart(
    { language },
    {
      name: path.basename(audioPath),
      contentType: "audio/wav",
      data,
    },
  );
  headers["Content-Type"] = contentType;

  const start = Date.now();
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/api/v1/tools/transcribe`, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    throw new VoiceTranscriptionError(
      `Consilium transcribe endpoint unreachable: ${(err as Error).message}`,
      "network",
    );
  }
  const durationMs = Date.now() - start;

  if (res.status === 404) {
    throw new VoiceTranscriptionError(
      "OpenAI key required for voice; run `consilium config set keys.openai <key>` or `export OPENAI_API_KEY=...`",
      "backend_unavailable",
    );
  }
  if (!res.ok) {
    throw new VoiceTranscriptionError(
      `Consilium transcribe failed: HTTP ${res.status}`,
      "backend_unavailable",
    );
  }

  let payload: { text?: string; duration?: number } = {};
  try {
    payload = (await res.json()) as { text?: string; duration?: number };
  } catch {
    throw new VoiceTranscriptionError(
      "Consilium transcribe returned non-JSON response",
      "backend_unavailable",
    );
  }
  if (typeof payload.text !== "string") {
    throw new VoiceTranscriptionError(
      "Consilium transcribe response missing 'text'",
      "backend_unavailable",
    );
  }
  return { text: payload.text.trim(), durationMs };
}

export async function transcribeAudio(
  opts: TranscribeOptions,
): Promise<TranscriptResult> {
  if (!fs.existsSync(opts.audioPath)) {
    throw new VoiceTranscriptionError(
      `Audio file not found: ${opts.audioPath}`,
      "file_missing",
    );
  }
  const language = opts.language ?? "en";
  const openaiKey = getOpenAIKey();
  if (openaiKey) {
    return transcribeViaOpenAI(opts.audioPath, language, openaiKey);
  }
  return transcribeViaConsiliumBackend(opts.audioPath, language);
}
