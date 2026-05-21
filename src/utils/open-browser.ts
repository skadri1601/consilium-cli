import open from "open";

/**
 * Open a URL in the default browser (cross-platform, works on Windows).
 */
export function openBrowser(url: string): void {
  open(url).catch(() => {
    console.log(`Open this URL in your browser: ${url}`);
  });
}
