export interface ReleaseNote {
  version: string;
  date: string;
  body: string;
}

const PACKAGE = "@myconsilium/cli";
const GITHUB_REPO = "skadri1601/consilium";
const MAX_LINES = 60;
const TRUNCATION_NOTE = "... (truncated, see full release notes online)";

function stripVersionPrefix(version: string): string {
  return version.replace(/^v/i, "");
}

function truncateBody(body: string): string {
  const lines = body.split(/\r?\n/);
  if (lines.length <= MAX_LINES) return body;
  return [...lines.slice(0, MAX_LINES), "", TRUNCATION_NOTE].join("\n");
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

async function fetchFromNpm(version: string): Promise<ReleaseNote | null> {
  try {
    const v = stripVersionPrefix(version);
    const res = await fetch(`https://registry.npmjs.org/${PACKAGE}/${v}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      version?: string;
      _npmVersion?: string;
      time?: Record<string, string>;
      releaseNotes?: string;
      description?: string;
      readme?: string;
    };
    if (!data.version) return null;
    const body = (data.releaseNotes ?? data.description ?? "").trim();
    if (!body) return null;
    const timeMap = data.time ?? {};
    const date = formatDate(timeMap[data.version]);
    return {
      version: data.version,
      date,
      body: truncateBody(body),
    };
  } catch {
    return null;
  }
}

async function fetchFromGithub(version: string): Promise<ReleaseNote | null> {
  try {
    const v = stripVersionPrefix(version);
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/v${v}`,
      {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      tag_name?: string;
      name?: string;
      body?: string;
      published_at?: string;
      created_at?: string;
    };
    const body = (data.body ?? "").trim();
    if (!body) return null;
    const tag = data.tag_name ?? `v${v}`;
    return {
      version: stripVersionPrefix(tag),
      date: formatDate(data.published_at ?? data.created_at),
      body: truncateBody(body),
    };
  } catch {
    return null;
  }
}

export async function fetchReleaseNotes(
  version: string,
): Promise<ReleaseNote | null> {
  const fromGithub = await fetchFromGithub(version);
  if (fromGithub) return fromGithub;
  const fromNpm = await fetchFromNpm(version);
  if (fromNpm) return fromNpm;
  return null;
}

function compareVersions(a: string, b: string): number {
  const pa = stripVersionPrefix(a)
    .split(".")
    .map((n) => Number.parseInt(n, 10));
  const pb = stripVersionPrefix(b)
    .split(".")
    .map((n) => Number.parseInt(n, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const ai = Number.isFinite(pa[i]) ? (pa[i] as number) : 0;
    const bi = Number.isFinite(pb[i]) ? (pb[i] as number) : 0;
    if (ai < bi) return -1;
    if (ai > bi) return 1;
  }
  return 0;
}

export async function fetchSinceVersion(
  currentVersion: string,
): Promise<ReleaseNote[]> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30`,
      {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return [];
    const releases = (await res.json()) as Array<{
      tag_name?: string;
      body?: string;
      published_at?: string;
      created_at?: string;
      draft?: boolean;
      prerelease?: boolean;
    }>;
    const notes: ReleaseNote[] = [];
    for (const r of releases) {
      if (r.draft || r.prerelease) continue;
      if (!r.tag_name) continue;
      const version = stripVersionPrefix(r.tag_name);
      if (compareVersions(version, currentVersion) <= 0) continue;
      const body = (r.body ?? "").trim();
      if (!body) continue;
      notes.push({
        version,
        date: formatDate(r.published_at ?? r.created_at),
        body: truncateBody(body),
      });
    }
    notes.sort((a, b) => compareVersions(b.version, a.version));
    return notes;
  } catch {
    return [];
  }
}

export function releaseNotesUrl(version: string): string {
  const v = stripVersionPrefix(version);
  return `https://github.com/${GITHUB_REPO}/releases/tag/v${v}`;
}
