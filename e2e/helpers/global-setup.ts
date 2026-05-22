import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, "../..");
const DIST_ENTRY = path.join(PKG_ROOT, "dist", "index.js");

export default async function globalSetup(): Promise<void> {
  if (fs.existsSync(DIST_ENTRY)) return;
  // Run the package-local build script; pnpm is available in the workspace.
  const result = spawnSync("pnpm", ["build"], {
    cwd: PKG_ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `pnpm build failed (exit ${result.status}); cannot run e2e tests without dist/index.js`,
    );
  }
  if (!fs.existsSync(DIST_ENTRY)) {
    throw new Error(`Build succeeded but ${DIST_ENTRY} is still missing`);
  }
}
