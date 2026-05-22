import {
  detectSandboxCapabilities,
  runInSandboxNative,
  type SandboxCapabilities,
  type SandboxOptions,
  type SandboxRunResult,
} from "./sandbox-native";

export interface SandboxAvailability {
  available: boolean;
  reason?: string;
}

const FALLBACK_REASON =
  "Native sandbox not yet implemented. See docs/superpowers/specs/2026-05-20-cli-sandbox-design.md. Use --worktree for git isolation.";

function capsToAvailability(caps: SandboxCapabilities): SandboxAvailability {
  if (caps.available) {
    return { available: true, reason: undefined };
  }
  if (caps.mechanism === "worktree-fallback") {
    return { available: false, reason: caps.reason ?? FALLBACK_REASON };
  }
  if (caps.reason && caps.reason.length > 0) {
    return { available: false, reason: caps.reason };
  }
  return { available: false, reason: FALLBACK_REASON };
}

export function isSandboxAvailable(): SandboxAvailability {
  return capsToAvailability(detectSandboxCapabilities());
}

export async function runInSandbox(
  cmd: string,
  args: string[],
  opts?: SandboxOptions,
): Promise<SandboxRunResult> {
  const caps = detectSandboxCapabilities();
  if (!caps.available) {
    throw new Error(caps.reason ?? FALLBACK_REASON);
  }
  return runInSandboxNative(cmd, args, opts ?? {});
}

export function describeSandboxStub(): string {
  const avail = isSandboxAvailable();
  if (avail.available) {
    const caps = detectSandboxCapabilities();
    return `Native sandbox available (platform=${caps.platform}, mechanism=${caps.mechanism}).`;
  }
  return avail.reason ?? FALLBACK_REASON;
}

export { detectSandboxCapabilities } from "./sandbox-native";
export type {
  SandboxCapabilities,
  SandboxOptions,
  SandboxRunResult,
} from "./sandbox-native";
