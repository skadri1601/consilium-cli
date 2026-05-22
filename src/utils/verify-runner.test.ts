import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runVerify,
  buildScreenshotPath,
  buildVideoPath,
  __setPuppeteerLoaderForTests,
} from "./verify-runner";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "consilium-verify-"));
});

afterEach(() => {
  __setPuppeteerLoaderForTests(null);
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("buildScreenshotPath", () => {
  it("generates a timestamped screenshot path", () => {
    const fixed = new Date(Date.UTC(2026, 4, 20, 14, 5, 9));
    const out = buildScreenshotPath("/tmp/v", fixed);
    expect(out).toBe("/tmp/v/screenshot-20260520T140509.png");
  });

  it("generates a timestamped video path", () => {
    const fixed = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    expect(buildVideoPath("/tmp/v", fixed)).toBe(
      "/tmp/v/recording-20260101T000000.webm",
    );
  });
});

describe("runVerify", () => {
  it("throws a clear error when puppeteer is not installed", async () => {
    __setPuppeteerLoaderForTests(async () => null);
    await expect(
      runVerify({ url: "https://example.com", outputDir: tmpDir }),
    ).rejects.toThrow(/puppeteer is not installed/i);
  });

  it("rejects empty URL", async () => {
    __setPuppeteerLoaderForTests(
      async () =>
        ({
          launch: vi.fn(),
        }) as never,
    );
    await expect(runVerify({ url: "" } as never)).rejects.toThrow(
      /url is required/,
    );
  });

  it("invokes puppeteer flow, captures screenshot, summarizes DOM", async () => {
    const screenshotFn = vi.fn(async () => {});
    const evaluateFn = vi.fn(async () =>
      JSON.stringify({ title: "Demo", buttons: 3, links: 7, inputs: 2 }),
    );
    const gotoFn = vi.fn(async () => {});
    const waitFn = vi.fn(async () => {});
    const closeFn = vi.fn(async () => {});

    const fakePage = {
      goto: gotoFn,
      waitForSelector: waitFn,
      screenshot: screenshotFn,
      evaluate: evaluateFn,
    };
    const fakeBrowser = {
      newPage: async () => fakePage,
      close: closeFn,
    };
    const launchFn = vi.fn(async () => fakeBrowser);
    __setPuppeteerLoaderForTests(
      async () =>
        ({
          launch: launchFn,
        }) as never,
    );

    const result = await runVerify({
      url: "https://example.com/login",
      selector: "#submit",
      outputDir: tmpDir,
    });

    expect(launchFn).toHaveBeenCalledTimes(1);
    expect(gotoFn).toHaveBeenCalledWith(
      "https://example.com/login",
      expect.objectContaining({ waitUntil: "load" }),
    );
    expect(waitFn).toHaveBeenCalledWith(
      "#submit",
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(screenshotFn).toHaveBeenCalledTimes(1);
    expect(result.screenshotPath.startsWith(tmpDir)).toBe(true);
    expect(result.screenshotPath.endsWith(".png")).toBe(true);
    expect(result.domSummary).toBe('title="Demo" buttons=3 links=7 inputs=2');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(closeFn).toHaveBeenCalledTimes(1);
  });

  it("skips waitForSelector when no selector is given", async () => {
    const waitFn = vi.fn(async () => {});
    const fakePage = {
      goto: vi.fn(async () => {}),
      waitForSelector: waitFn,
      screenshot: vi.fn(async () => {}),
      evaluate: vi.fn(async () =>
        JSON.stringify({ title: "x", buttons: 0, links: 0, inputs: 0 }),
      ),
    };
    const fakeBrowser = {
      newPage: async () => fakePage,
      close: vi.fn(async () => {}),
    };
    __setPuppeteerLoaderForTests(
      async () =>
        ({
          launch: async () => fakeBrowser,
        }) as never,
    );

    await runVerify({ url: "https://example.com", outputDir: tmpDir });
    expect(waitFn).not.toHaveBeenCalled();
  });

  it("returns a videoPath when videoCapture is enabled", async () => {
    const fakePage = {
      goto: vi.fn(async () => {}),
      waitForSelector: vi.fn(async () => {}),
      screenshot: vi.fn(async () => {}),
      evaluate: vi.fn(async () =>
        JSON.stringify({ title: "T", buttons: 1, links: 1, inputs: 0 }),
      ),
    };
    const fakeBrowser = {
      newPage: async () => fakePage,
      close: vi.fn(async () => {}),
    };
    __setPuppeteerLoaderForTests(
      async () =>
        ({
          launch: async () => fakeBrowser,
        }) as never,
    );

    const result = await runVerify({
      url: "https://example.com",
      outputDir: tmpDir,
      videoCapture: true,
    });
    expect(result.videoPath).toBeDefined();
    expect(result.videoPath!.endsWith(".webm")).toBe(true);
  });

  it("creates the output directory before running", async () => {
    const targetDir = path.join(tmpDir, "nested", "deeper");
    expect(fs.existsSync(targetDir)).toBe(false);

    const fakePage = {
      goto: vi.fn(async () => {}),
      waitForSelector: vi.fn(async () => {}),
      screenshot: vi.fn(async () => {}),
      evaluate: vi.fn(async () =>
        JSON.stringify({ title: "", buttons: 0, links: 0, inputs: 0 }),
      ),
    };
    const fakeBrowser = {
      newPage: async () => fakePage,
      close: vi.fn(async () => {}),
    };
    __setPuppeteerLoaderForTests(
      async () =>
        ({
          launch: async () => fakeBrowser,
        }) as never,
    );

    await runVerify({ url: "https://example.com", outputDir: targetDir });
    expect(fs.existsSync(targetDir)).toBe(true);
  });
});
