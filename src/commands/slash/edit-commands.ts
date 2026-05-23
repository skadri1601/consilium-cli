import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { ChatSession } from "../chat-session";
import type { SlashResult } from "./shared-state";
import { style } from "../../utils/visual-system";

const st = style();
import { resolveProjectRoot } from "../../utils/project-root";
import {
  consumeWritePermission,
  requestWritePermission,
} from "../../utils/codebase-permissions";
import { applyEdits, parseEditsFromSynthesis } from "../../utils/apply-edits";
import { formatEditPreview } from "../../utils/diff-preview";
import {
  restoreRollbackSnapshot,
  type RollbackSnapshot,
} from "../../utils/rollback";
import { getGitDiff, getCurrentBranch } from "../../utils/git-context";
import { navigateDiffs, parseUnifiedDiff } from "../../utils/diff-navigator";

export async function slashApply(session: ChatSession): Promise<SlashResult> {
  if (!session.lastGoldenPrompt) {
    console.log(
      st.warning("No synthesis available to apply. Run a debate first.\n"),
    );
    return "continue";
  }

  const rootInfo = resolveProjectRoot(process.cwd());
  const parsed = parseEditsFromSynthesis(
    session.lastGoldenPrompt,
    rootInfo.root,
  );
  if (parsed.edits.length === 0) {
    console.log(st.warning("No structured edits found in last synthesis."));
    console.log(
      st.dim("Expected format: ```consilium-edits with JSON edit entries.\n"),
    );
    return "continue";
  }

  console.log(st.bold("\nPlanned edits\n"));
  console.log(formatEditPreview(parsed.preview));
  console.log("");

  const level = await requestWritePermission(rootInfo.root);
  if (level === "deny" || !consumeWritePermission(rootInfo.root)) {
    console.log(
      st.warning("Write permission denied. No files were changed.\n"),
    );
    return "continue";
  }

  const result = applyEdits(rootInfo.root, parsed.edits);
  console.log(
    st.success(`Applied ${result.applied} edit(s).`),
    st.dim(`Rollback snapshot: ${result.snapshot.id}\n`),
  );
  return "continue";
}

export async function slashRollback(args: string[]): Promise<SlashResult> {
  const snapshotId = args[0]?.trim();
  const historyDir = path.join(
    process.env.HOME || process.env.USERPROFILE || "",
    ".consilium",
    "edit-history",
  );

  if (!snapshotId) {
    try {
      const entries = fs
        .readdirSync(historyDir)
        .filter((e) => e.startsWith("edit_"))
        .sort()
        .reverse()
        .slice(0, 10);
      if (entries.length === 0) {
        console.log(st.dim("\nNo edit snapshots found.\n"));
        return "continue";
      }
      console.log(st.bold("\nRecent edit snapshots (newest first)\n"));
      for (const entry of entries) {
        const snapshotFile = path.join(historyDir, entry, "snapshot.json");
        try {
          const snap = JSON.parse(
            fs.readFileSync(snapshotFile, "utf-8"),
          ) as RollbackSnapshot;
          const files = snap.files.map((f) => f.path).join(", ");
          console.log(
            st.brand(entry),
            st.dim(
              `  ${snap.createdAt}  ${snap.files.length} file(s): ${files}`,
            ),
          );
        } catch {
          console.log(st.brand(entry));
        }
      }
      console.log(st.dim("\nUsage: /rollback <snapshotId>\n"));
    } catch {
      console.log(st.dim("\nNo edit snapshots found.\n"));
    }
    return "continue";
  }

  const snapshotFile = path.join(historyDir, snapshotId, "snapshot.json");
  if (!fs.existsSync(snapshotFile)) {
    console.log(st.error(`Snapshot not found: ${snapshotId}\n`));
    return "continue";
  }

  let snapshot: RollbackSnapshot;
  try {
    snapshot = JSON.parse(
      fs.readFileSync(snapshotFile, "utf-8"),
    ) as RollbackSnapshot;
  } catch {
    console.log(st.error("Could not read snapshot file.\n"));
    return "continue";
  }

  console.log(
    st.bold(
      `\nRolling back ${snapshot.files.length} file(s) from ${snapshot.createdAt}\n`,
    ),
  );
  for (const f of snapshot.files) {
    console.log(st.dim(`  ${f.existed ? "restore" : "delete"} ${f.path}`));
  }
  console.log("");

  restoreRollbackSnapshot(snapshot);
  console.log(st.success("Rollback complete.\n"));
  return "continue";
}

export async function slashReview(
  args: string[],
  session: ChatSession,
): Promise<SlashResult> {
  const filePath = args[0]?.trim();
  if (!filePath) {
    console.log(
      st.dim(
        "Usage: /review <file-path>  - sends a file for targeted code review debate\n",
      ),
    );
    return "continue";
  }
  const rootInfo = resolveProjectRoot(process.cwd());
  const fullPath = path.resolve(rootInfo.root, filePath);
  if (!fs.existsSync(fullPath)) {
    console.log(st.error(`File not found: ${filePath}\n`));
    return "continue";
  }
  let content: string;
  try {
    content = fs.readFileSync(fullPath, "utf-8");
  } catch {
    console.log(st.error(`Cannot read file: ${filePath}\n`));
    return "continue";
  }
  session.contextManager.addFile(fullPath);
  console.log(
    st.success(
      `Added ${filePath} to context. Your next debate will review this file.\n`,
    ),
  );
  console.log(
    st.dim(
      `Tip: ask "Review ${filePath} for bugs, style issues, and improvements"\n`,
    ),
  );
  return "continue";
}

export function slashEditHistory(): SlashResult {
  const auditFile = path.join(
    process.env.HOME || process.env.USERPROFILE || "",
    ".consilium",
    "edit-history",
    "audit.jsonl",
  );
  if (!fs.existsSync(auditFile)) {
    console.log(st.dim("\nNo edit history found.\n"));
    return "continue";
  }
  const lines = fs
    .readFileSync(auditFile, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .slice(-20)
    .reverse();
  if (lines.length === 0) {
    console.log(st.dim("\nNo edit history found.\n"));
    return "continue";
  }
  console.log(st.bold("\nRecent edits (newest first)\n"));
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as {
        ts: string;
        snapshotId: string;
        files: string[];
        count: number;
      };
      const files =
        entry.files.slice(0, 3).join(", ") +
        (entry.files.length > 3 ? ` +${entry.files.length - 3} more` : "");
      console.log(
        st.brand(entry.snapshotId),
        st.dim(`  ${entry.ts}  ${entry.count} file(s): ${files}`),
      );
    } catch (err: unknown) {
      console.log(
        st.dim(
          `(malformed entry: ${err instanceof Error ? err.message : String(err)})`,
        ),
      );
    }
  }
  console.log(st.dim("\nUse /rollback <snapshotId> to restore.\n"));
  return "continue";
}

export async function slashGitDiff(): Promise<SlashResult> {
  const rootInfo = resolveProjectRoot(process.cwd());
  const branch = getCurrentBranch(rootInfo.root);
  const diff = getGitDiff(rootInfo.root);
  if (!diff) {
    console.log(st.dim("\nNo uncommitted changes in the working tree.\n"));
    return "continue";
  }
  console.log(st.bold(`\nGit diff${branch ? ` (${branch})` : ""}\n`));
  const truncated =
    diff.length > 6000 ? diff.slice(0, 6000) + "\n... (truncated)" : diff;
  console.log(truncated);
  console.log("");

  if (!process.stdin.isTTY) {
    return "continue";
  }

  const answer = await new Promise<string>((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(st.dim("Open interactive navigator? [y/N] "), (input) => {
      rl.close();
      resolve(input.trim().toLowerCase());
    });
  });

  if (answer !== "y" && answer !== "yes") {
    return "continue";
  }

  const hunks = parseUnifiedDiff(diff);
  if (hunks.length === 0) {
    console.log(st.dim("\nNo diff to navigate.\n"));
    return "continue";
  }

  try {
    await navigateDiffs(hunks);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(st.error(`\nNavigator error: ${msg}\n`));
  }
  console.log("");
  return "continue";
}
