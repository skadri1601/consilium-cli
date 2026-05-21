import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildEditPreview, type EditPreview } from "./diff-preview";
import { parseEditActions, type EditAction } from "./patch-parser";
import {
  createRollbackSnapshot,
  restoreRollbackSnapshot,
  type RollbackSnapshot,
} from "./rollback";

const AUDIT_FILE = path.join(
  os.homedir(),
  ".consilium",
  "edit-history",
  "audit.jsonl",
);

export interface ParsedEditsResult {
  edits: EditAction[];
  preview: EditPreview[];
}

export interface ApplyEditsResult {
  applied: number;
  snapshot: RollbackSnapshot;
}

function assertInsideRoot(rootPath: string, relativePath: string): string {
  const fullPath = path.resolve(rootPath, relativePath);
  const normalizedRoot = path.resolve(rootPath);
  if (
    !(
      fullPath === normalizedRoot ||
      fullPath.startsWith(normalizedRoot + path.sep)
    )
  ) {
    throw new Error(`Unsafe edit path outside project root: ${relativePath}`);
  }
  return fullPath;
}

function writeAuditRecord(data: Record<string, unknown>): void {
  const auditDir = path.dirname(AUDIT_FILE);
  if (!fs.existsSync(auditDir)) {
    fs.mkdirSync(auditDir, { recursive: true });
  }
  fs.appendFileSync(AUDIT_FILE, JSON.stringify(data) + "\n", "utf-8");
}

export function parseEditsFromSynthesis(
  synthesis: string,
  rootPath: string,
): ParsedEditsResult {
  const edits = parseEditActions(synthesis);
  if (edits.length === 0) {
    return { edits: [], preview: [] };
  }
  for (const edit of edits) {
    assertInsideRoot(rootPath, edit.path);
  }
  const preview = buildEditPreview(rootPath, edits);
  return { edits, preview };
}

function applySurgicalEdit(
  fullPath: string,
  edit: Extract<EditAction, { kind: "edit" }>,
): void {
  if (!fs.existsSync(fullPath)) {
    throw new Error(
      `Cannot edit ${edit.path}: file does not exist (use kind:'write' to create)`,
    );
  }
  const original = fs.readFileSync(fullPath, "utf-8");
  if (edit.oldString === "") {
    throw new Error(
      `Cannot edit ${edit.path}: empty old_string is reserved for new files (use kind:'write')`,
    );
  }
  if (edit.oldString === edit.newString) {
    throw new Error(
      `Cannot edit ${edit.path}: old_string and new_string are identical`,
    );
  }

  if (edit.replaceAll) {
    if (!original.includes(edit.oldString)) {
      throw new Error(`Cannot edit ${edit.path}: old_string not found`);
    }
    const updated = original.split(edit.oldString).join(edit.newString);
    fs.writeFileSync(fullPath, updated, "utf-8");
    return;
  }

  const first = original.indexOf(edit.oldString);
  if (first === -1) {
    throw new Error(`Cannot edit ${edit.path}: old_string not found`);
  }
  const second = original.indexOf(edit.oldString, first + 1);
  if (second !== -1) {
    throw new Error(
      `Cannot edit ${edit.path}: old_string is not unique (appears multiple times). Pass replaceAll=true or extend the snippet.`,
    );
  }
  const updated =
    original.slice(0, first) +
    edit.newString +
    original.slice(first + edit.oldString.length);
  fs.writeFileSync(fullPath, updated, "utf-8");
}

export function applyEdits(
  rootPath: string,
  edits: EditAction[],
): ApplyEditsResult {
  if (edits.length === 0) {
    throw new Error("No edits to apply.");
  }
  const snapshot = createRollbackSnapshot(rootPath, edits);

  try {
    for (const edit of edits) {
      const fullPath = assertInsideRoot(rootPath, edit.path);
      if (edit.kind === "delete") {
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
        continue;
      }
      if (edit.kind === "edit") {
        applySurgicalEdit(fullPath, edit);
        continue;
      }
      // kind === 'write'
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, edit.content, "utf-8");
    }
  } catch (error) {
    restoreRollbackSnapshot(snapshot);
    throw error;
  }

  writeAuditRecord({
    ts: new Date().toISOString(),
    snapshotId: snapshot.id,
    rootPath,
    files: edits.map((e) => e.path),
    kinds: edits.map((e) => e.kind),
    count: edits.length,
  });

  return {
    applied: edits.length,
    snapshot,
  };
}
