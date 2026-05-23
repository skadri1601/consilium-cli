import fs from "node:fs";
import path from "node:path";
import type { ChatSession } from "../chat-session";
import type { SlashResult } from "./shared-state";
import { style } from "../../utils/visual-system";
import { resolveProjectRoot } from "../../utils/project-root";
import {
  hasCodebasePermission,
  requestCodebasePermission,
  revokeCodebasePermission,
} from "../../utils/codebase-permissions";

const st = style();

export function slashFile(args: string[], session: ChatSession): SlashResult {
  const filePath = args[0];
  if (!filePath) {
    console.log(st.warning("Usage: /file <path>"));
    return "continue";
  }
  try {
    session.contextManager.addFile(filePath);
    session.contextFilePaths.push(filePath);
    const files = session.contextManager.getFiles();
    const entry = files.find((f) => f.name === path.basename(filePath));
    const sizeKb = entry ? (entry.size / 1024).toFixed(1) : "?";
    console.log(
      st.success(`Added ${path.basename(filePath)} to context (${sizeKb} KB)`),
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(st.error("Error:"), msg);
  }
  return "continue";
}

export function slashImage(args: string[], session: ChatSession): SlashResult {
  const imagePath = args[0];
  if (!imagePath) {
    console.log(st.warning("Usage: /image <path>"));
    return "continue";
  }
  try {
    session.contextManager.addImage(imagePath);
    session.contextImagePaths.push(imagePath);
    console.log(st.success(`Added ${path.basename(imagePath)} to context`));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(st.error("Error:"), msg);
  }
  return "continue";
}

export function slashClear(session: ChatSession): SlashResult {
  session.contextManager.clear();
  session.contextFilePaths = [];
  session.contextImagePaths = [];
  console.log(st.success("Context cleared."));
  return "continue";
}

export function slashStatus(session: ChatSession): SlashResult {
  const files = session.contextManager.getFiles();
  const totalSize = session.contextManager.getTotalSize();
  console.log(st.bold("\nSession Status\n"));
  if (session.name) console.log(st.brand("Name:"), session.name);
  if (session.id) console.log(st.brand("ID:"), session.id);
  console.log(st.brand("Models:"), session.models.join(", "));
  console.log(st.brand("Context files:"), files.length);
  if (files.length > 0) {
    files.forEach((f) =>
      console.log(st.dim(`  - ${f.name} (${f.size} bytes)`)),
    );
    console.log(st.brand("Total context size:"), `${totalSize} bytes`);
  }
  console.log(st.brand("Debates in session:"), session.debates.length);
  if (session.contextManifest) {
    console.log(
      st.brand("Scanned context:"),
      `${session.contextManifest.loaded} files (${(session.contextManifest.loadedBytes / 1024).toFixed(1)} KB)`,
    );
  }
  if (session.lastGoldenPrompt) {
    const preview =
      session.lastGoldenPrompt.length > 50
        ? session.lastGoldenPrompt.substring(0, 50) + "..."
        : session.lastGoldenPrompt;
    console.log(st.brand("Last synthesis:"), preview);
  }
  console.log("");
  return "continue";
}

export function slashManifest(session: ChatSession): SlashResult {
  const manifest = session.contextManifest;
  if (!manifest) {
    console.log(st.dim("\nNo workspace scan manifest available yet.\n"));
    return "continue";
  }
  console.log(st.bold("\nContext manifest\n"));
  console.log(st.brand("Root:"), manifest.root);
  console.log(st.brand("Loaded:"), `${manifest.loaded} files`);
  console.log(st.brand("Loaded bytes:"), `${manifest.loadedBytes} bytes`);
  console.log(
    st.brand("Skipped:"),
    `secret=${manifest.skipped.secret}, binary=${manifest.skipped.binary}, payload-limit=${manifest.skipped["payload-limit"]}, skip-rule=${manifest.skipped["skip-rule"]}, read-error=${manifest.skipped["read-error"]}, max-files=${manifest.skipped["max-files"]}`,
  );
  console.log("");
  return "continue";
}

export function slashScope(): SlashResult {
  const rootInfo = resolveProjectRoot(process.cwd());
  console.log(st.bold("\nScope info\n"));
  console.log(st.brand("CWD:"), rootInfo.cwd);
  console.log(st.brand("Project root:"), rootInfo.root);
  console.log(st.brand("Git repo:"), rootInfo.isGitRepo ? "yes" : "no");
  if (rootInfo.isSubdirectory) {
    console.log(
      st.warning(
        "Launched from subdirectory - full project context is loaded from root.",
      ),
    );
  }
  console.log("");
  return "continue";
}

export async function slashCodebase(args: string[]): Promise<SlashResult> {
  const rootInfo = resolveProjectRoot(process.cwd());
  const scopePath = rootInfo.root;
  const sub = args[0]?.toLowerCase();

  if (sub === "allow" || sub === "grant") {
    const ok = await requestCodebasePermission(scopePath);
    console.log(
      ok
        ? st.success("Codebase read access granted for this project scope.")
        : st.warning("Not granted."),
    );
    console.log("");
    return "continue";
  }

  if (sub === "revoke") {
    revokeCodebasePermission(scopePath);
    console.log(st.success("Revoked codebase permission for this project.\n"));
    return "continue";
  }

  if (sub === "status") {
    const h = hasCodebasePermission(scopePath);
    console.log(st.bold("\nCodebase permission\n"));
    if (h === true)
      console.log(st.success("Granted"), st.dim("for"), scopePath);
    else if (h === false)
      console.log(
        st.warning("Previously denied"),
        st.dim("- run /codebase allow to try again"),
      );
    else
      console.log(
        st.dim("Not set yet"),
        st.dim("- run /codebase allow before codebase-aware debates"),
      );
    console.log("");
    return "continue";
  }

  console.log(
    st.dim("Usage: /codebase allow | /codebase status | /codebase revoke"),
  );
  console.log(
    st.dim("  allow   - prompt to allow reading project files for debates"),
  );
  console.log(st.dim("  status  - show whether this directory is allowed"));
  console.log(st.dim("  revoke  - remove saved permission for this directory"));
  console.log("");
  return "continue";
}
