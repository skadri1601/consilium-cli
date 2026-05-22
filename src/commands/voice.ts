import fs from "node:fs";
import path from "node:path";
import {
  detectRecorder,
  installHint,
  recordAudio,
  type RecorderTool,
} from "../utils/audio-recorder.js";
import {
  transcribeAudio,
  VoiceTranscriptionError,
} from "../utils/voice-input.js";
import { style } from "../utils/visual-system.js";

const st = style();

export interface VoiceCommandOptions {
  once?: boolean;
  language?: string;
  debate?: boolean;
  mode?: string;
  maxSeconds?: number;
}

function cleanupTempAudio(audioPath: string): void {
  try {
    fs.rmSync(audioPath, { force: true });
    const dir = path.dirname(audioPath);
    if (
      dir.includes("consilium-voice-") &&
      fs.existsSync(dir) &&
      fs.readdirSync(dir).length === 0
    ) {
      fs.rmdirSync(dir);
    }
  } catch {
    // best-effort cleanup
  }
}

export async function voiceCommand(
  opts: VoiceCommandOptions = {},
): Promise<void> {
  const tool: RecorderTool = detectRecorder();
  if (tool === "unsupported") {
    console.log(st.error("[VOICE] No supported audio recorder found."));
    console.log(st.dim(installHint(tool)));
    process.exitCode = 1;
    return;
  }

  console.log(st.brand(`[VOICE] Using recorder: ${tool}`));

  let audioPath: string;
  try {
    audioPath = await recordAudio({ maxSeconds: opts.maxSeconds ?? 30 });
  } catch (err) {
    console.log(
      st.error(`[VOICE] Recording failed: ${(err as Error).message}`),
    );
    process.exitCode = 1;
    return;
  }

  console.log(st.dim(`[VOICE] Captured ${audioPath}`));
  console.log(st.brand("[VOICE] Transcribing via Whisper..."));

  let transcript;
  try {
    transcript = await transcribeAudio({
      audioPath,
      language: opts.language ?? "en",
    });
  } catch (err) {
    if (err instanceof VoiceTranscriptionError) {
      console.log(st.error(`[VOICE] ${err.message}`));
    } else {
      console.log(
        st.error(`[VOICE] Transcription failed: ${(err as Error).message}`),
      );
    }
    cleanupTempAudio(audioPath);
    process.exitCode = 1;
    return;
  }

  console.log();
  console.log(st.bold("Transcript:"));
  console.log(transcript.text);
  console.log();
  if (typeof transcript.cost === "number") {
    console.log(
      st.dim(
        `(latency ${transcript.durationMs}ms, ~$${transcript.cost.toFixed(4)})`,
      ),
    );
  } else {
    console.log(st.dim(`(latency ${transcript.durationMs}ms)`));
  }

  cleanupTempAudio(audioPath);

  if (opts.debate && transcript.text.length > 0) {
    const { debateCommand } = await import("./debate.js");
    await debateCommand(transcript.text, { mode: opts.mode ?? "council" });
    return;
  }

  if (opts.once) {
    return;
  }
}
