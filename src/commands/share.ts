import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DEFAULT_API_ORIGIN, loadConfig } from "../utils/config.js";
import { SessionManager } from "../utils/session-manager.js";
import { style } from "../utils/visual-system.js";

const st = style();

export interface ShareCommandOptions {
  public?: boolean;
  expiresIn?: number;
}

interface ShareResponse {
  url?: string;
  token?: string;
  shareId?: string;
  id?: string;
  public?: boolean;
  expiresAt?: string | null;
}

function localExportPath(sessionId: string): string {
  return path.resolve(process.cwd(), `.consilium-session-${sessionId}.json`);
}

function loadSessionPayload(sessionId: string): unknown | null {
  const sessionDir = path.join(os.homedir(), ".consilium", "sessions");
  const manager = new SessionManager(sessionDir);
  try {
    const session = manager.loadSession(sessionId);
    return session.toJSON();
  } catch {
    return null;
  }
}

function exportSessionLocally(sessionId: string): string | null {
  const payload = loadSessionPayload(sessionId);
  if (!payload) return null;
  const outPath = localExportPath(sessionId);
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf-8");
  return outPath;
}

export async function shareCommand(
  sessionId: string,
  opts: ShareCommandOptions = {},
): Promise<void> {
  const config = loadConfig();
  const apiUrl = (config.apiUrl ?? DEFAULT_API_ORIGIN).replace(/\/$/, "");
  const isPublic = opts.public ?? false;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

  const payload = loadSessionPayload(sessionId);

  const body: Record<string, unknown> = { public: isPublic };
  if (payload !== null) body.payload = payload;
  if (opts.expiresIn) body.expiresIn = opts.expiresIn;

  let res: Response | null = null;
  let networkError = false;
  try {
    res = await fetch(`${apiUrl}/api/v1/sessions/${sessionId}/share`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    networkError = true;
  }

  const apiAccepted =
    !networkError &&
    res &&
    (res.status === 201 || res.status === 200 || res.ok);

  if (apiAccepted && res) {
    let parsed: ShareResponse = {};
    try {
      parsed = (await res.json()) as ShareResponse;
    } catch {
      parsed = {};
    }
    const url = parsed.url;
    const token = parsed.token;
    const shareId = parsed.shareId ?? parsed.id ?? sessionId;

    console.log(st.success(`Shared session ${sessionId}`));
    if (url) console.log(st.dim(`  ${url}`));
    else console.log(st.dim(`  share id: ${shareId}`));
    if (token) console.log(st.dim(`  token: ${token}`));
    if (isPublic) console.log(st.dim("  visibility: public"));
    else console.log(st.dim("  visibility: link-only"));
    if (parsed.expiresAt) console.log(st.dim(`  expires: ${parsed.expiresAt}`));
    return;
  }

  const shouldFallback =
    networkError ||
    !res ||
    res.status === 404 ||
    res.status === 503 ||
    res.status >= 500;

  if (!shouldFallback && res) {
    console.log(
      st.error(`Share request failed: HTTP ${res.status} ${res.statusText}`),
    );
    process.exitCode = 1;
    return;
  }

  const exported = exportSessionLocally(sessionId);
  if (!exported) {
    console.log(
      st.error(
        `Session ${sessionId} not found locally and share endpoint unavailable.`,
      ),
    );
    console.log(
      st.dim(
        "  Backend share endpoint not yet implemented. Once available, this command will POST to /api/v1/sessions/<id>/share.",
      ),
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    st.warning(
      "Share endpoint not available - exported session to local JSON instead.",
    ),
  );
  console.log(st.dim(`  ${exported}`));
  console.log(
    st.dim(
      "  Local-export fallback: send this file to a collaborator who can run `consilium sessions resume`.",
    ),
  );
}
