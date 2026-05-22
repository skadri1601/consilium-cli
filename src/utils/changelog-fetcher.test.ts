import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

import {
  fetchReleaseNotes,
  fetchSinceVersion,
  releaseNotesUrl,
} from "./changelog-fetcher";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("fetchReleaseNotes", () => {
  it("parses a GitHub release response", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        tag_name: "v0.6.0",
        name: "0.6.0",
        body: "## Features\n- Added matrix theme\n- Added ocean theme",
        published_at: "2026-05-19T10:00:00Z",
      }),
    );

    const notes = await fetchReleaseNotes("0.6.0");

    expect(notes).not.toBeNull();
    expect(notes!.version).toBe("0.6.0");
    expect(notes!.date).toBe("2026-05-19");
    expect(notes!.body).toContain("Added matrix theme");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/skadri1601/consilium/releases/tags/v0.6.0",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/vnd.github+json",
        }),
      }),
    );
  });

  it("strips a leading v from the supplied version", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        tag_name: "v1.2.3",
        body: "notes",
        published_at: "2026-01-01T00:00:00Z",
      }),
    );

    const notes = await fetchReleaseNotes("v1.2.3");

    expect(notes!.version).toBe("1.2.3");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/skadri1601/consilium/releases/tags/v1.2.3",
      expect.any(Object),
    );
  });

  it("falls back to the npm registry when GitHub 404s", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 404));
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        version: "0.6.0",
        releaseNotes: "npm release notes body",
        time: { "0.6.0": "2026-05-18T12:00:00Z" },
      }),
    );

    const notes = await fetchReleaseNotes("0.6.0");

    expect(notes).not.toBeNull();
    expect(notes!.version).toBe("0.6.0");
    expect(notes!.date).toBe("2026-05-18");
    expect(notes!.body).toBe("npm release notes body");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenLastCalledWith(
      "https://registry.npmjs.org/@myconsilium/cli/0.6.0",
      expect.any(Object),
    );
  });

  it("returns null when both sources return 404", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 404));
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 404));

    const notes = await fetchReleaseNotes("9.9.9");

    expect(notes).toBeNull();
  });

  it("returns null when both sources throw", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"));
    mockFetch.mockRejectedValueOnce(new Error("network down"));

    const notes = await fetchReleaseNotes("0.6.0");

    expect(notes).toBeNull();
  });

  it("falls back when GitHub returns an empty body", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ tag_name: "v0.6.0", body: "" }),
    );
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        version: "0.6.0",
        description: "fallback description",
        time: { "0.6.0": "2026-05-17T00:00:00Z" },
      }),
    );

    const notes = await fetchReleaseNotes("0.6.0");

    expect(notes).not.toBeNull();
    expect(notes!.body).toBe("fallback description");
  });

  it("truncates very long bodies to 60 lines", async () => {
    const longBody = Array.from(
      { length: 120 },
      (_, i) => `line ${i + 1}`,
    ).join("\n");
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        tag_name: "v0.6.0",
        body: longBody,
        published_at: "2026-05-19T10:00:00Z",
      }),
    );

    const notes = await fetchReleaseNotes("0.6.0");

    expect(notes).not.toBeNull();
    const lines = notes!.body.split("\n");
    expect(lines.length).toBeLessThanOrEqual(63);
    expect(notes!.body).toContain("line 1");
    expect(notes!.body).toContain("line 60");
    expect(notes!.body).not.toContain("line 120");
    expect(notes!.body).toContain("truncated");
  });
});

describe("fetchSinceVersion", () => {
  it("returns only versions newer than the current one, sorted desc", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          tag_name: "v0.5.0",
          body: "old",
          published_at: "2026-04-01T00:00:00Z",
        },
        {
          tag_name: "v0.7.0",
          body: "newer",
          published_at: "2026-05-15T00:00:00Z",
        },
        {
          tag_name: "v0.6.0",
          body: "newer-too",
          published_at: "2026-05-01T00:00:00Z",
        },
        {
          tag_name: "v0.8.0",
          body: "draft skipped",
          draft: true,
        },
      ]),
    );

    const notes = await fetchSinceVersion("0.5.0");

    expect(notes.map((n) => n.version)).toEqual(["0.7.0", "0.6.0"]);
  });

  it("returns [] when GitHub is unreachable", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"));
    const notes = await fetchSinceVersion("0.5.0");
    expect(notes).toEqual([]);
  });

  it("returns [] on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 500));
    const notes = await fetchSinceVersion("0.5.0");
    expect(notes).toEqual([]);
  });
});

describe("releaseNotesUrl", () => {
  it("builds the canonical GitHub releases URL", () => {
    expect(releaseNotesUrl("0.6.0")).toBe(
      "https://github.com/skadri1601/consilium/releases/tag/v0.6.0",
    );
    expect(releaseNotesUrl("v1.2.3")).toBe(
      "https://github.com/skadri1601/consilium/releases/tag/v1.2.3",
    );
  });
});
