import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type RecorderTool = "sox" | "arecord" | "parecord" | "unsupported";

export interface RecordOptions {
  maxSeconds?: number;
  outputPath?: string;
}

let activeProcess: ChildProcess | null = null;

function whichSync(bin: string): boolean {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const res = spawnSync(cmd, [bin], { stdio: "ignore" });
    return res.status === 0;
  } catch {
    return false;
  }
}

export function detectRecorder(): RecorderTool {
  if (process.platform === "win32") return "unsupported";
  if (whichSync("sox")) return "sox";
  if (whichSync("rec")) return "sox";
  if (process.platform === "linux") {
    if (whichSync("arecord")) return "arecord";
    if (whichSync("parecord")) return "parecord";
  }
  return "unsupported";
}

export function installHint(tool: RecorderTool): string {
  if (tool !== "unsupported") return "";
  if (process.platform === "darwin") {
    return "Install with: brew install sox";
  }
  if (process.platform === "linux") {
    return "Install with: sudo apt-get install sox  (or: alsa-utils for arecord)";
  }
  if (process.platform === "win32") {
    return "Voice recording is not supported on Windows in this CLI version.";
  }
  return "No supported audio recorder found (need sox, arecord, or parecord).";
}

function defaultOutputPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "consilium-voice-"));
  return path.join(dir, "recording.wav");
}

function buildRecorderArgs(
  tool: RecorderTool,
  outPath: string,
  maxSeconds: number,
): { cmd: string; args: string[] } {
  if (tool === "sox") {
    const cmd = whichSync("sox") ? "sox" : "rec";
    if (cmd === "sox") {
      return {
        cmd,
        args: [
          "-d",
          "-c",
          "1",
          "-r",
          "16000",
          "-b",
          "16",
          "-e",
          "signed-integer",
          outPath,
          "trim",
          "0",
          String(maxSeconds),
        ],
      };
    }
    return {
      cmd,
      args: [
        "-c",
        "1",
        "-r",
        "16000",
        "-b",
        "16",
        "-e",
        "signed-integer",
        outPath,
        "trim",
        "0",
        String(maxSeconds),
      ],
    };
  }
  if (tool === "arecord") {
    return {
      cmd: "arecord",
      args: ["-f", "cd", "-d", String(maxSeconds), "-t", "wav", outPath],
    };
  }
  if (tool === "parecord") {
    return {
      cmd: "parecord",
      args: ["--channels=1", "--rate=16000", "--file-format=wav", outPath],
    };
  }
  return { cmd: "", args: [] };
}

export async function recordAudio(opts: RecordOptions = {}): Promise<string> {
  const tool = detectRecorder();
  if (tool === "unsupported") {
    throw new Error(installHint(tool));
  }
  const maxSeconds = opts.maxSeconds ?? 30;
  const outPath = opts.outputPath ?? defaultOutputPath();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const { cmd, args } = buildRecorderArgs(tool, outPath, maxSeconds);
  process.stdout.write("[VOICE] Recording... press Ctrl+C to stop\n");

  return new Promise<string>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    activeProcess = child;

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const killOnSignal = (): void => {
      if (!child.killed) child.kill("SIGINT");
    };
    process.once("SIGINT", killOnSignal);

    let timeoutHandle: NodeJS.Timeout | null = null;
    if (tool === "parecord") {
      timeoutHandle = setTimeout(() => {
        if (!child.killed) child.kill("SIGINT");
      }, maxSeconds * 1000);
    }

    child.on("error", (err: Error) => {
      process.removeListener("SIGINT", killOnSignal);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      activeProcess = null;
      reject(new Error(`Failed to start recorder "${cmd}": ${err.message}`));
    });

    child.on("close", (code: number | null) => {
      process.removeListener("SIGINT", killOnSignal);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      activeProcess = null;
      const fileExists =
        fs.existsSync(outPath) && fs.statSync(outPath).size > 0;
      if (fileExists) {
        resolve(outPath);
        return;
      }
      const detail = stderr.trim() ? `: ${stderr.trim().split("\n")[0]}` : "";
      reject(
        new Error(
          `Recorder "${cmd}" exited with code ${code ?? "null"}${detail}`,
        ),
      );
    });
  });
}

export async function stopRecording(): Promise<void> {
  if (activeProcess && !activeProcess.killed) {
    activeProcess.kill("SIGINT");
  }
  activeProcess = null;
}
