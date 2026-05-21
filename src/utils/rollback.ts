import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EditAction } from "./patch-parser";

const EDIT_HISTORY_DIR = path.join(os.homedir(), ".consilium", "edit-history");

interface RollbackFile {
  path: string;
  backupPath: string | null;
  existed: boolean;
}

export interface RollbackSnapshot {
  id: string;
  rootPath: string;
  createdAt: string;
  files: RollbackFile[];
}

function ensureHistoryDir(): void {
  if (!fs.existsSync(EDIT_HISTORY_DIR)) {
    fs.mkdirSync(EDIT_HISTORY_DIR, { recursive: true });
  }
}

export function createRollbackSnapshot(
  rootPath: string,
  edits: EditAction[],
): RollbackSnapshot {
  ensureHistoryDir();
  const id = `edit_${Date.now()}`;
  const snapshotDir = path.join(EDIT_HISTORY_DIR, id);
  fs.mkdirSync(snapshotDir, { recursive: true });

  const files: RollbackFile[] = edits.map((edit, index) => {
    const fullPath = path.resolve(rootPath, edit.path);
    const existed = fs.existsSync(fullPath);
    if (!existed) {
      return { path: edit.path, backupPath: null, existed: false };
    }
    const backupPath = path.join(snapshotDir, `${index}.bak`);
    fs.copyFileSync(fullPath, backupPath);
    return { path: edit.path, backupPath, existed: true };
  });

  const snapshot: RollbackSnapshot = {
    id,
    rootPath,
    createdAt: new Date().toISOString(),
    files,
  };

  fs.writeFileSync(
    path.join(snapshotDir, "snapshot.json"),
    JSON.stringify(snapshot, null, 2),
    "utf-8",
  );
  return snapshot;
}

export function restoreRollbackSnapshot(snapshot: RollbackSnapshot): void {
  for (const file of snapshot.files) {
    const target = path.resolve(snapshot.rootPath, file.path);
    if (!file.existed) {
      if (fs.existsSync(target)) {
        fs.unlinkSync(target);
      }
      continue;
    }
    if (!file.backupPath || !fs.existsSync(file.backupPath)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file.backupPath, target);
  }
}
