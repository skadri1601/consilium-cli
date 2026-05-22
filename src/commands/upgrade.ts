import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { style } from "../utils/visual-system.js";
import {
  fetchReleaseNotes,
  releaseNotesUrl,
} from "../utils/changelog-fetcher.js";

const execFileAsync = promisify(execFile);
const st = style();

export interface UpgradeOptions {
  check?: boolean;
}

interface UpgradeResult {
  manager: "pnpm" | "npm" | "yarn" | "bun" | "binary" | "unknown";
  currentVersion: string;
  latestVersion?: string;
  upgraded: boolean;
}

const PACKAGE = "@myconsilium/cli";

function isUpToDate(current: string, latest: string): boolean {
  const c = current.replace(/^v/, "").split(".").map(Number);
  const l = latest.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    if ((c[i] || 0) < (l[i] || 0)) return false;
    if ((c[i] || 0) > (l[i] || 0)) return true;
  }
  return true;
}

function readCurrentVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../../package.json") as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const response = await fetch(
      `https://registry.npmjs.org/${PACKAGE}/latest`,
      {
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

async function detectManager(): Promise<UpgradeResult["manager"]> {
  // Order: pnpm > npm > yarn > bun. If none work for a global query of our
  // package, assume the user is on a standalone binary and tell them to use
  // the installer script.
  const candidates: Array<{
    name: UpgradeResult["manager"];
    cmd: string;
    args: string[];
  }> = [
    { name: "pnpm", cmd: "pnpm", args: ["list", "-g", "--depth=0", PACKAGE] },
    { name: "npm", cmd: "npm", args: ["ls", "-g", PACKAGE, "--depth=0"] },
    {
      name: "yarn",
      cmd: "yarn",
      args: ["global", "list", "--pattern", PACKAGE],
    },
    { name: "bun", cmd: "bun", args: ["pm", "ls", "-g"] },
  ];

  for (const c of candidates) {
    try {
      const { stdout } = await execFileAsync(c.cmd, c.args, { timeout: 8000 });
      if (stdout.includes(PACKAGE) || stdout.includes("myconsilium")) {
        return c.name;
      }
    } catch {
      // Manager not installed or package not present - try next.
    }
  }
  return "unknown";
}

async function runUpgrade(manager: UpgradeResult["manager"]): Promise<boolean> {
  const cmd: Record<typeof manager, [string, string[]] | null> = {
    pnpm: ["pnpm", ["add", "-g", `${PACKAGE}@latest`]],
    npm: ["npm", ["install", "-g", `${PACKAGE}@latest`]],
    yarn: ["yarn", ["global", "add", `${PACKAGE}@latest`]],
    bun: ["bun", ["add", "-g", `${PACKAGE}@latest`]],
    binary: null,
    unknown: null,
  };
  const entry = cmd[manager];
  if (!entry) return false;

  console.log(st.dim(`  Running: ${entry[0]} ${entry[1].join(" ")}`));
  await execFileAsync(entry[0], entry[1], {
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return true;
}

export async function upgradeCommand(
  options: UpgradeOptions = {},
): Promise<void> {
  const currentVersion = readCurrentVersion();
  console.log(st.bold(`Consilium CLI`), st.dim(`v${currentVersion}`));
  console.log("");

  console.log(st.dim("  Checking npm registry…"));
  const latestVersion = await fetchLatestVersion();
  if (!latestVersion) {
    console.log(
      st.warning(
        "  Could not reach the npm registry. Check your network and try again.",
      ),
    );
    return;
  }

  if (isUpToDate(currentVersion, latestVersion)) {
    console.log(
      st.success(`  Already on the latest version (${latestVersion}).`),
    );
    return;
  }

  console.log(`  Latest available: ${st.brand(`v${latestVersion}`)}`);
  console.log("");

  if (options.check) {
    console.log(
      st.dim("  Run `consilium upgrade` to install the new version."),
    );
    return;
  }

  const manager = await detectManager();
  if (manager === "unknown") {
    console.log(st.warning("  Could not detect how Consilium was installed."));
    console.log(
      st.dim(
        "  If you used the standalone binary or the curl|sh installer, re-run:",
      ),
    );
    console.log(st.dim("    curl -fsSL https://install.myconsilium.xyz | sh"));
    console.log(
      st.dim("  Otherwise, upgrade manually with your package manager:"),
    );
    console.log(st.dim(`    pnpm add -g ${PACKAGE}@latest`));
    return;
  }

  console.log(st.dim(`  Detected install via ${manager}.`));
  try {
    const ok = await runUpgrade(manager);
    if (ok) {
      console.log(st.success(`  Upgraded to v${latestVersion}.`));
      console.log(
        st.dim(
          "  Restart any running Consilium processes to pick up the new version.",
        ),
      );
      await printWhatsNew(latestVersion);
    } else {
      console.log(
        st.warning("  Upgrade not supported for this install method."),
      );
    }
  } catch (err) {
    console.log(st.error(`  Upgrade failed: ${(err as Error).message}`));
    console.log(st.dim("  You can retry manually:"));
    console.log(
      st.dim(
        `    ${manager} ${manager === "yarn" ? "global add" : "add -g"} ${PACKAGE}@latest`,
      ),
    );
  }
}

async function printWhatsNew(version: string): Promise<void> {
  try {
    const notes = await fetchReleaseNotes(version);
    if (!notes) {
      console.log("");
      console.log(st.dim(`  Release notes: ${releaseNotesUrl(version)}`));
      return;
    }
    const dateSuffix = notes.date ? ` (${notes.date})` : "";
    console.log("");
    console.log(
      `${st.brand(`What's new in v${notes.version}`)}${st.dim(dateSuffix)}`,
    );
    console.log("");
    console.log(notes.body);
    console.log("");
    console.log(st.dim(`  Full notes: ${releaseNotesUrl(notes.version)}`));
  } catch {
    console.log("");
    console.log(st.dim(`  Release notes: ${releaseNotesUrl(version)}`));
  }
}
