import fs from "node:fs";
import type { ChatSession } from "../chat-session";
import { SessionManager } from "../../utils/session-manager";
import { getExtras, type SlashResult } from "./shared-state";
import {
  consumeWritePermission,
  requestWritePermission,
} from "../../utils/codebase-permissions";
import { resolveProjectRoot } from "../../utils/project-root";
import { log } from "../../utils/logger";
import { style } from "../../utils/visual-system";

const st = style();

export function slashExit(
  sessionManager: SessionManager,
  session: ChatSession,
): SlashResult {
  const sessionId = sessionManager.saveSession(session);
  log("INFO", "session_saved", { sessionId });
  console.log(
    st.success("\nSession saved. Resume with:"),
    st.brand(`consilium sessions resume ${sessionId}\n`),
  );
  return "exit";
}

export async function slashSave(
  args: string[],
  session: ChatSession,
  sessionManager: SessionManager,
): Promise<SlashResult> {
  const filepath = args[0];
  if (filepath) {
    if (session.lastGoldenPrompt) {
      try {
        const rootInfo = resolveProjectRoot(process.cwd());
        const level = await requestWritePermission(rootInfo.root);
        if (level === "deny" || !consumeWritePermission(rootInfo.root)) {
          console.log(
            st.warning(
              "Write permission denied. Use /permissions status to review policy.",
            ),
          );
          return "continue";
        }
        fs.writeFileSync(filepath, session.lastGoldenPrompt, "utf-8");
        console.log(st.success(`Saved synthesis to ${filepath}`));
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(st.error("Failed to save synthesis file:"), msg);
        console.error(st.dim(`Path: ${filepath}`));
      }
    } else {
      console.log(st.warning("No synthesis to save. Run a debate first."));
    }
  } else {
    const sessionId = sessionManager.saveSession(session);
    log("INFO", "session_saved", { sessionId });
    console.log(
      st.success("Session saved. Resume with:"),
      st.brand(`consilium sessions resume ${sessionId}`),
    );
  }
  return "continue";
}

export function slashRecap(session: ChatSession): SlashResult {
  const debates = (session.debates || []).filter((d) => d?.topic);
  if (debates.length === 0) {
    console.log(st.dim("\nNo debates in this session yet.\n"));
    return "continue";
  }
  const lastFive = debates.slice(-5);
  const parts: string[] = [];
  for (let i = 0; i < lastFive.length; i++) {
    const d = lastFive[i];
    if (!d) continue;
    const synthesis = d.goldenPrompt?.trim() ?? "";
    const snippet =
      synthesis.length > 0
        ? synthesis.length > 140
          ? `${synthesis.slice(0, 137)}...`
          : synthesis
        : "(no synthesis yet)";
    parts.push(`(${i + 1}) "${d.topic}" - ${snippet}`);
  }
  const sessionLabel = session.name || session.id || "current session";
  const totalNote =
    debates.length > lastFive.length
      ? ` Earlier turns omitted (showing last ${lastFive.length} of ${debates.length}).`
      : "";
  const paragraph = `Recap of ${sessionLabel}: across ${debates.length} debate(s), the most recent turns covered: ${parts.join(" ")}.${totalNote}`;
  console.log(st.bold("\nSession recap\n"));
  console.log(paragraph);
  console.log("");
  return "continue";
}

export async function slashStop(session: ChatSession): Promise<SlashResult> {
  const extras = getExtras(session);
  const debateId = extras.activeDebateId;
  if (!debateId) {
    console.log(st.dim("\nNo active debate to stop.\n"));
    return "continue";
  }
  try {
    await session.client.cancelDebate(debateId);
    extras.activeDebateId = undefined;
    console.log(
      st.success(`\nRequested cancel for debate ${debateId}.`),
      st.dim(" The stream will emit debate:cancelled when the worker acks.\n"),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(st.error(`\nCould not cancel debate ${debateId}: ${msg}\n`));
  }
  return "continue";
}

export async function slashCheckpoint(
  args: string[],
  session: ChatSession,
  sessionManager: SessionManager,
): Promise<SlashResult> {
  const name = args.join(" ").trim() || undefined;
  if (!session.id) {
    sessionManager.saveSession(session);
  }
  const sessionId = session.id;
  if (!sessionId) {
    console.log(st.error("Could not determine session id for checkpoint.\n"));
    return "continue";
  }
  try {
    const mod = await import("../../utils/session-manager.js");
    if (typeof mod.snapshotSession !== "function") {
      console.log(st.warning("Checkpoint feature not yet available.\n"));
      return "continue";
    }
    const snap = mod.snapshotSession(sessionId, name);
    console.log(st.success("Checkpoint created:"), st.brand(snap.id));
    if (snap.label) console.log(st.dim(`  label: ${snap.label}`));
    console.log(st.dim(`  use /rewind ${snap.id} to restore this snapshot\n`));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(st.warning(`Checkpoint not yet available: ${msg}\n`));
  }
  return "continue";
}

export async function slashRewind(
  args: string[],
  session: ChatSession,
  sessionManager: SessionManager,
): Promise<SlashResult> {
  const snapshotId = args[0]?.trim();
  const sessionId = session.id;
  if (!sessionId) {
    console.log(
      st.warning("No active session id. Save the session first with /save.\n"),
    );
    return "continue";
  }

  let mod: typeof import("../../utils/session-manager.js");
  try {
    mod = await import("../../utils/session-manager.js");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(st.warning(`Rewind not yet available: ${msg}\n`));
    return "continue";
  }

  if (!snapshotId) {
    if (typeof mod.listSnapshots !== "function") {
      console.log(st.warning("Snapshot listing not yet available.\n"));
      return "continue";
    }
    const snaps = mod.listSnapshots(sessionId);
    if (snaps.length === 0) {
      console.log(
        st.dim(
          "\nNo snapshots for this session. Use /checkpoint to create one.\n",
        ),
      );
      return "continue";
    }
    console.log(st.bold("\nAvailable snapshots (newest first)\n"));
    for (const snap of snaps) {
      const label = snap.label ? ` ${st.dim(`(${snap.label})`)}` : "";
      const ts = new Date(snap.createdAt).toLocaleString();
      console.log(st.brand(snap.id), st.dim(` ${ts}`), label);
    }
    console.log(st.dim("\nUsage: /rewind <snapshot-id>\n"));
    return "continue";
  }

  try {
    if (typeof mod.restoreSnapshot !== "function") {
      console.log(st.warning("Restore not yet available.\n"));
      return "continue";
    }
    mod.restoreSnapshot(sessionId, snapshotId);
    const loaded = sessionManager.loadSession(sessionId);
    session.debates = loaded.debates || [];
    session.name = loaded.name || session.name;
    session.models = loaded.models || session.models;
    session.mode = loaded.mode;
    session.lastGoldenPrompt = loaded.lastGoldenPrompt;
    session.contextFilePaths = loaded.contextFilePaths || [];
    session.contextImagePaths = loaded.contextImagePaths || [];
    console.log(
      st.success(`Restored snapshot ${snapshotId}.`),
      st.dim(`  ${session.debates.length} debate(s) in restored state\n`),
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(st.error(`Could not restore snapshot: ${msg}\n`));
  }
  return "continue";
}

export async function slashFork(
  args: string[],
  session: ChatSession,
  sessionManager: SessionManager,
): Promise<SlashResult> {
  const name = args.join(" ").trim() || undefined;
  if (!session.id) {
    sessionManager.saveSession(session);
  }
  const sessionId = session.id;
  if (!sessionId) {
    console.log(st.error("Could not determine session id for fork.\n"));
    return "continue";
  }
  try {
    const mod = await import("../../utils/session-manager.js");
    if (typeof mod.forkSession !== "function") {
      console.log(st.warning("Fork not yet available.\n"));
      return "continue";
    }
    const newId = mod.forkSession(sessionId, name);
    console.log(
      st.success("Forked session:"),
      st.brand(newId),
      st.dim(`  resume with: consilium sessions resume ${newId}\n`),
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(st.warning(`Fork not yet available: ${msg}\n`));
  }
  return "continue";
}
