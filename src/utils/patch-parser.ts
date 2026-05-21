/**
 * EditAction format - backward compatible with the legacy { path, content }
 * shape, extended with surgical { kind: 'edit', oldString, newString } and
 * delete operations modeled after Claude Code's Edit tool semantics.
 */
export type EditAction =
  | { kind: "write"; path: string; content: string }
  | {
      kind: "edit";
      path: string;
      oldString: string;
      newString: string;
      replaceAll?: boolean;
    }
  | { kind: "delete"; path: string };

interface FencedBlock {
  language: string;
  body: string;
  rawLanguage: string;
}

function extractFencedBlocks(text: string): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  const regex = /```([a-zA-Z0-9_:./\\-]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    blocks.push({
      language: (match[1] || "").trim().toLowerCase(),
      rawLanguage: match[1] || "",
      body: match[2] || "",
    });
  }
  return blocks;
}

// SEARCH/REPLACE block markers. Anchored to start-of-line so the parser
// is linear in the body length: indexOf scans ahead to the next marker
// rather than letting a [\s\S]*? lazily backtrack across the whole text
// (Sonar S5852 ReDoS). Markers must be at line starts and use 5+ chars.
const SR_SEARCH = /^<{5,}\s*SEARCH\s*$/m;
const SR_DIVIDER = /^={5,}\s*$/m;
const SR_REPLACE = /^>{5,}\s*REPLACE\s*$/m;

interface SearchReplaceBlock {
  pathLine: string | null;
  oldString: string;
  newString: string;
  endIndex: number;
}

function findNextSearchReplace(
  body: string,
  fromIndex: number,
): SearchReplaceBlock | null {
  const slice = body.slice(fromIndex);
  const searchMatch = SR_SEARCH.exec(slice);
  if (!searchMatch) return null;

  const searchStart = fromIndex + searchMatch.index;
  const searchEnd = searchStart + searchMatch[0].length;

  const afterSearch = body.slice(searchEnd);
  const divMatch = SR_DIVIDER.exec(afterSearch);
  if (!divMatch) return null;
  const divStart = searchEnd + divMatch.index;
  const divEnd = divStart + divMatch[0].length;

  const afterDiv = body.slice(divEnd);
  const repMatch = SR_REPLACE.exec(afterDiv);
  if (!repMatch) return null;
  const repStart = divEnd + repMatch.index;
  const repEnd = repStart + repMatch[0].length;

  const oldString = body
    .slice(searchEnd, divStart)
    .replace(/^\n/, "")
    .replace(/\n$/, "");
  const newString = body
    .slice(divEnd, repStart)
    .replace(/^\n/, "")
    .replace(/\n$/, "");

  // Look back for an inline path on the line just before the SEARCH marker.
  const before = body.slice(fromIndex, searchStart);
  const lastNewline = before.lastIndexOf("\n", before.length - 2);
  const lineStart = lastNewline >= 0 ? lastNewline + 1 : 0;
  const lineRaw = before.slice(lineStart).replace(/\n$/, "").trim();
  const pathLine = lineRaw.length > 0 ? lineRaw : null;

  return { pathLine, oldString, newString, endIndex: repEnd };
}

function parseSearchReplaceBody(
  body: string,
  fallbackPath: string | null,
): EditAction[] {
  const actions: EditAction[] = [];
  let cursor = 0;
  while (cursor < body.length) {
    const block = findNextSearchReplace(body, cursor);
    if (!block) break;
    const targetPath = block.pathLine ?? fallbackPath;
    if (targetPath) {
      actions.push({
        kind: "edit",
        path: targetPath,
        oldString: block.oldString,
        newString: block.newString,
      });
    }
    cursor = block.endIndex;
  }
  return actions;
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string") return value;
  }
  return "";
}

function isEditShape(
  obj: Record<string, unknown>,
  kind: string | undefined,
): boolean {
  return (
    kind === "edit" ||
    obj.old_string !== undefined ||
    obj.oldString !== undefined
  );
}

function coerceJsonEdit(item: unknown): EditAction | null {
  if (typeof item !== "object" || item === null) return null;
  const obj = item as Record<string, unknown>;
  const path = typeof obj.path === "string" ? obj.path : "";
  if (!path) return null;

  const kind = typeof obj.kind === "string" ? obj.kind : undefined;

  if (kind === "delete") {
    return { kind: "delete", path };
  }
  if (isEditShape(obj, kind)) {
    const oldString = pickString(obj, "old_string", "oldString");
    const newString = pickString(obj, "new_string", "newString");
    const replaceAll = Boolean(obj.replace_all ?? obj.replaceAll ?? false);
    return { kind: "edit", path, oldString, newString, replaceAll };
  }
  // Default: whole-file write (back-compat with { path, content }).
  if (typeof obj.content === "string") {
    return { kind: "write", path, content: obj.content };
  }
  return null;
}

function parseJsonEdits(body: string): EditAction[] {
  try {
    const parsed: unknown = JSON.parse(body);
    if (Array.isArray(parsed)) {
      return parsed
        .map(coerceJsonEdit)
        .filter((a): a is EditAction => a !== null);
    }
    if (typeof parsed === "object" && parsed !== null) {
      const edits = (parsed as { edits?: unknown }).edits;
      if (Array.isArray(edits)) {
        return edits
          .map(coerceJsonEdit)
          .filter((a): a is EditAction => a !== null);
      }
    }
  } catch {
    return [];
  }
  return [];
}

function parseFileBlock(block: FencedBlock): EditAction | null {
  const m = /^file:(.+)$/i.exec(block.rawLanguage.trim());
  if (!m) return null;
  const path = (m[1] || "").trim();
  if (!path) return null;
  return { kind: "write", path, content: block.body };
}

export function parseEditActions(text: string): EditAction[] {
  const blocks = extractFencedBlocks(text);
  const actions: EditAction[] = [];

  for (const block of blocks) {
    if (block.language === "consilium-edits" || block.language === "json") {
      actions.push(...parseJsonEdits(block.body));
      continue;
    }
    const consiliumEditMatch = /^consilium-edit:(.+)$/i.exec(
      block.rawLanguage.trim(),
    );
    if (consiliumEditMatch) {
      const path = (consiliumEditMatch[1] || "").trim();
      actions.push(...parseSearchReplaceBody(block.body, path));
      continue;
    }
    if (block.language === "diff" || block.language === "search-replace") {
      actions.push(...parseSearchReplaceBody(block.body, null));
      continue;
    }
    const fileAction = parseFileBlock(block);
    if (fileAction) actions.push(fileAction);
  }

  return actions;
}
