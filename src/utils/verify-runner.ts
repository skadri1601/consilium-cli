import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface VerifyOptions {
  url: string;
  selector?: string;
  outputDir?: string;
  videoCapture?: boolean;
  timeoutMs?: number;
}

export interface VerifyResult {
  screenshotPath: string;
  videoPath?: string;
  durationMs: number;
  domSummary: string;
}

export const DEFAULT_VERIFY_DIR = path.join(
  os.homedir(),
  ".consilium",
  "verify",
);

const PUPPETEER_INSTALL_MESSAGE =
  "Puppeteer is not installed. Run `npm install -g puppeteer` to enable /verify. Or use --no-puppeteer to skip verification.";

interface DocLike {
  title: string;
  querySelectorAll: (selector: string) => { length: number };
}

interface PuppeteerBrowser {
  newPage: () => Promise<PuppeteerPage>;
  close: () => Promise<void>;
}

interface PuppeteerPage {
  goto: (
    url: string,
    opts?: { waitUntil?: string; timeout?: number },
  ) => Promise<unknown>;
  waitForSelector: (
    selector: string,
    opts?: { timeout?: number },
  ) => Promise<unknown>;
  screenshot: (opts: { path: string; fullPage?: boolean }) => Promise<unknown>;
  evaluate: <T>(fn: () => T) => Promise<T>;
}

interface PuppeteerModule {
  launch: (opts?: {
    headless?: boolean | "new";
    args?: string[];
  }) => Promise<PuppeteerBrowser>;
}

type PuppeteerLoader = () => Promise<PuppeteerModule | null>;

let loaderOverride: PuppeteerLoader | null = null;

export function __setPuppeteerLoaderForTests(
  loader: PuppeteerLoader | null,
): void {
  loaderOverride = loader;
}

async function defaultLoad(): Promise<PuppeteerModule | null> {
  try {
    const dynamicImport = new Function(
      "specifier",
      "return import(specifier);",
    ) as (specifier: string) => Promise<unknown>;
    const mod = (await dynamicImport("puppeteer")) as {
      default?: PuppeteerModule;
    } & PuppeteerModule;
    return (mod.default ?? mod) as PuppeteerModule;
  } catch {
    return null;
  }
}

async function loadPuppeteer(): Promise<PuppeteerModule> {
  const loader = loaderOverride ?? defaultLoad;
  const mod = await loader();
  if (!mod) {
    throw new Error(PUPPETEER_INSTALL_MESSAGE);
  }
  return mod;
}

function timestampForFilename(now: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    now.getUTCFullYear().toString() +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    "T" +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes()) +
    pad(now.getUTCSeconds())
  );
}

export function buildScreenshotPath(
  outputDir: string,
  now: Date = new Date(),
): string {
  const ts = timestampForFilename(now);
  return path.join(outputDir, `screenshot-${ts}.png`);
}

export function buildVideoPath(
  outputDir: string,
  now: Date = new Date(),
): string {
  const ts = timestampForFilename(now);
  return path.join(outputDir, `recording-${ts}.webm`);
}

export async function runVerify(opts: VerifyOptions): Promise<VerifyResult> {
  if (!opts.url || typeof opts.url !== "string") {
    throw new Error("/verify: url is required");
  }
  const outputDir = opts.outputDir ?? DEFAULT_VERIFY_DIR;
  fs.mkdirSync(outputDir, { recursive: true });

  const puppeteer = await loadPuppeteer();
  const start = Date.now();
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    const navTimeout = opts.timeoutMs ?? 30000;
    await page.goto(opts.url, { waitUntil: "load", timeout: navTimeout });
    if (opts.selector) {
      await page.waitForSelector(opts.selector, { timeout: navTimeout });
    }
    const screenshotPath = buildScreenshotPath(outputDir);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const evalFn = (() => {
      const doc = (globalThis as unknown as { document: DocLike }).document;
      const title = doc.title || "";
      const buttons = doc.querySelectorAll("button").length;
      const links = doc.querySelectorAll("a").length;
      const inputs = doc.querySelectorAll("input,textarea,select").length;
      return JSON.stringify({ title, buttons, links, inputs });
    }) as () => string;
    const summary = await page.evaluate<string>(evalFn);
    const parsed = JSON.parse(summary) as {
      title: string;
      buttons: number;
      links: number;
      inputs: number;
    };
    const domSummary = `title="${parsed.title}" buttons=${parsed.buttons} links=${parsed.links} inputs=${parsed.inputs}`;
    const result: VerifyResult = {
      screenshotPath,
      durationMs: Date.now() - start,
      domSummary,
    };
    if (opts.videoCapture) {
      result.videoPath = buildVideoPath(outputDir);
    }
    return result;
  } finally {
    await browser.close();
  }
}
