import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSpawnSync, mockLoadConfig, mockGetKey } = vi.hoisted(() => ({
  mockSpawnSync: vi.fn(),
  mockLoadConfig: vi.fn(),
  mockGetKey: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  return {
    ...actual,
    spawnSync: mockSpawnSync,
  };
});

vi.mock("./config", () => ({
  loadConfig: mockLoadConfig,
  DEFAULT_API_ORIGIN: "https://api.myconsilium.xyz",
}));

vi.mock("./key-manager", () => ({
  KeyManager: class {
    getKey = mockGetKey;
  },
}));

import { detectRecorder } from "./audio-recorder";
import { transcribeAudio, VoiceTranscriptionError } from "./voice-input";

const ORIGINAL_PLATFORM = process.platform;

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value, configurable: true });
}

function restorePlatform(): void {
  Object.defineProperty(process, "platform", {
    value: ORIGINAL_PLATFORM,
    configurable: true,
  });
}

let originalFetch: typeof fetch;
let originalOpenAIKey: string | undefined;
let tmpAudio: string;

beforeEach(() => {
  vi.clearAllMocks();
  originalFetch = globalThis.fetch;
  originalOpenAIKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  mockLoadConfig.mockReturnValue({
    apiUrl: "https://api.test.example",
    apiKey: "ck_test",
  });
  mockGetKey.mockReturnValue(undefined);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "consilium-voice-test-"));
  tmpAudio = path.join(dir, "clip.wav");
  fs.writeFileSync(tmpAudio, Buffer.from("RIFFFAKEWAVE"));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalOpenAIKey !== undefined) {
    process.env.OPENAI_API_KEY = originalOpenAIKey;
  } else {
    delete process.env.OPENAI_API_KEY;
  }
  restorePlatform();
  try {
    fs.rmSync(path.dirname(tmpAudio), { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("detectRecorder", () => {
  it("returns sox when sox is on PATH (linux)", () => {
    setPlatform("linux");
    mockSpawnSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "which" && args[0] === "sox") return { status: 0 };
      return { status: 1 };
    });
    expect(detectRecorder()).toBe("sox");
  });

  it("returns arecord on linux when sox missing but arecord present", () => {
    setPlatform("linux");
    mockSpawnSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "which" && args[0] === "arecord") return { status: 0 };
      return { status: 1 };
    });
    expect(detectRecorder()).toBe("arecord");
  });

  it("returns parecord on linux when only parecord present", () => {
    setPlatform("linux");
    mockSpawnSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "which" && args[0] === "parecord") return { status: 0 };
      return { status: 1 };
    });
    expect(detectRecorder()).toBe("parecord");
  });

  it("returns sox on darwin when sox installed", () => {
    setPlatform("darwin");
    mockSpawnSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "which" && args[0] === "sox") return { status: 0 };
      return { status: 1 };
    });
    expect(detectRecorder()).toBe("sox");
  });

  it("returns unsupported on windows", () => {
    setPlatform("win32");
    mockSpawnSync.mockReturnValue({ status: 0 });
    expect(detectRecorder()).toBe("unsupported");
  });

  it("returns unsupported when no binary found", () => {
    setPlatform("linux");
    mockSpawnSync.mockReturnValue({ status: 1 });
    expect(detectRecorder()).toBe("unsupported");
  });
});

describe("transcribeAudio - OpenAI direct", () => {
  it("POSTs multipart body to OpenAI when OPENAI_API_KEY is set", async () => {
    process.env.OPENAI_API_KEY = "sk-test-direct";
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ text: "hello world", duration: 2.5 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await transcribeAudio({ audioPath: tmpAudio });

    expect(result.text).toBe("hello world");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calls = fetchSpy.mock.calls as unknown as Array<unknown[]>;
    const url = calls[0]?.[0] as string;
    const init = calls[0]?.[1] as {
      headers?: Record<string, string>;
      body?: Buffer;
    };
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(init.headers?.Authorization).toBe("Bearer sk-test-direct");
    expect(init.headers?.["Content-Type"]).toMatch(/^multipart\/form-data;/);
    expect(init.body?.toString("utf-8")).toContain('name="model"');
    expect(init.body?.toString("utf-8")).toContain("whisper-1");
  });

  it("uses key from KeyManager when env var is unset", async () => {
    mockGetKey.mockImplementation((p: string) =>
      p === "openai" ? "sk-from-config" : undefined,
    );
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ text: "configured", duration: 1.0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await transcribeAudio({ audioPath: tmpAudio });
    expect(result.text).toBe("configured");
    const calls = fetchSpy.mock.calls as unknown as Array<unknown[]>;
    const init = calls[0]?.[1] as { headers?: Record<string, string> };
    expect(init.headers?.Authorization).toBe("Bearer sk-from-config");
  });

  it("surfaces Whisper error payload as VoiceTranscriptionError", async () => {
    process.env.OPENAI_API_KEY = "sk-bad";
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { message: "invalid_api_key" } }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    await expect(transcribeAudio({ audioPath: tmpAudio })).rejects.toThrow(
      /invalid_api_key/,
    );
  });
});

describe("transcribeAudio - Consilium backend fallback", () => {
  it("routes to consilium endpoint when no OpenAI key is available", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ text: "via backend" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await transcribeAudio({ audioPath: tmpAudio });
    expect(result.text).toBe("via backend");
    const calls = fetchSpy.mock.calls as unknown as Array<unknown[]>;
    const url = calls[0]?.[0] as string;
    const init = calls[0]?.[1] as { headers?: Record<string, string> };
    expect(url).toBe("https://api.test.example/api/v1/tools/transcribe");
    expect(init.headers?.Authorization).toBe("Bearer ck_test");
  });

  it("emits helpful message when consilium endpoint returns 404", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("not found", { status: 404 }),
    ) as unknown as typeof fetch;

    let caught: VoiceTranscriptionError | null = null;
    try {
      await transcribeAudio({ audioPath: tmpAudio });
    } catch (err) {
      caught = err as VoiceTranscriptionError;
    }
    expect(caught).not.toBeNull();
    expect(caught?.code).toBe("backend_unavailable");
    expect(caught?.message).toContain("consilium config set keys.openai");
  });

  it("throws file_missing when audio file does not exist", async () => {
    let caught: VoiceTranscriptionError | null = null;
    try {
      await transcribeAudio({ audioPath: "/nonexistent/path/clip.wav" });
    } catch (err) {
      caught = err as VoiceTranscriptionError;
    }
    expect(caught).not.toBeNull();
    expect(caught?.code).toBe("file_missing");
  });
});
