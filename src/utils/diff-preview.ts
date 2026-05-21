import fs from "node:fs";
import path from "node:path";
import type { EditAction } from "./patch-parser";

export interface EditPreview {
  path: string;
  exists: boolean;
  kind: EditAction["kind"];
  oldLines: number;
  newLines: number;
  deltaLines: number;
}

function countLines(content: string): number {
  if (!content) return 0;
  return content.split("\n").length;
}

// Simulate a surgical edit so the preview can report an accurate line delta
// without touching disk. Mirrors applySurgicalEdit's matching rules.
function simulateSurgicalEdit(
  oldContent: string,
  exists: boolean,
  edit: Extract<EditAction, { kind: "edit" }>,
): string {
  if (!exists) return "";
  if (edit.replaceAll) {
    return oldContent.split(edit.oldString).join(edit.newString);
  }
  const idx = oldContent.indexOf(edit.oldString);
  if (idx === -1) return oldContent;
  return (
    oldContent.slice(0, idx) +
    edit.newString +
    oldContent.slice(idx + edit.oldString.length)
  );
}

function previewWriteOrEdit(rootPath: string, edit: EditAction): EditPreview {
  const fullPath = path.resolve(rootPath, edit.path);
  const exists = fs.existsSync(fullPath);
  const oldContent = exists ? fs.readFileSync(fullPath, "utf-8") : "";
  const oldLines = countLines(oldContent);

  if (edit.kind === "delete") {
    return {
      path: edit.path,
      exists,
      kind: "delete",
      oldLines,
      newLines: 0,
      deltaLines: -oldLines,
    };
  }

  const newContent: string =
    edit.kind === "write"
      ? edit.content
      : simulateSurgicalEdit(oldContent, exists, edit);
  const newLines = countLines(newContent);
  return {
    path: edit.path,
    exists,
    kind: edit.kind,
    oldLines,
    newLines,
    deltaLines: newLines - oldLines,
  };
}

export function buildEditPreview(
  rootPath: string,
  edits: EditAction[],
): EditPreview[] {
  return edits.map((edit) => previewWriteOrEdit(rootPath, edit));
}

export function formatEditPreview(preview: EditPreview[]): string {
  if (preview.length === 0) return "No edits detected.";
  const lines: string[] = [];
  for (const item of preview) {
    let state: string;
    if (item.kind === "delete") state = "delete";
    else if (item.kind === "edit") state = "edit";
    else state = item.exists ? "update" : "create";
    const delta =
      item.deltaLines >= 0 ? `+${item.deltaLines}` : `${item.deltaLines}`;
    lines.push(
      `${state.padEnd(7)} ${item.path} (${item.oldLines} -> ${item.newLines}, ${delta} lines)`,
    );
  }
  return lines.join("\n");
}
