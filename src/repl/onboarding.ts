import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { resolveProjectRoot } from "../utils/project-root.js";
import { detectWorkspace } from "../utils/workspace-detector.js";
import {
  hasCodebasePermission,
  grantCodebasePermission,
} from "../utils/codebase-permissions.js";
import { style } from "../utils/visual-system.js";
import { terminal } from "../utils/terminal-capabilities.js";

const ONBOARDED_FLAG_PATH = path.join(
  os.homedir(),
  ".consilium",
  "onboarded.json",
);

interface OnboardedFlag {
  ts: string;
  version: number;
}

function hasOnboarded(): boolean {
  return fs.existsSync(ONBOARDED_FLAG_PATH);
}

function markOnboarded(): void {
  const dir = path.dirname(ONBOARDED_FLAG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const flag: OnboardedFlag = { ts: new Date().toISOString(), version: 1 };
  fs.writeFileSync(ONBOARDED_FLAG_PATH, JSON.stringify(flag, null, 2), "utf-8");
}

async function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

/**
 * First-run onboarding shown the very first time a user lands in the
 * REPL. Skipped on subsequent runs (controlled by ~/.consilium/onboarded.json).
 *
 * Goals:
 *   1. Show the user that Consilium is a multi-AI council, not a single-model wrapper
 *   2. Auto-detect the project so they don't have to configure anything
 *   3. Get codebase-read consent up front so the agent toolkit works on first debate
 *   4. Give them ONE concrete next-action that demonstrates value
 *
 * Returns true if onboarding ran (regardless of choices), false if skipped.
 */
export async function runOnboarding(): Promise<boolean> {
  if (hasOnboarded()) return false;
  if (!terminal.isTTY) {
    // Non-TTY environments can't ask - just mark onboarded and move on
    // so we don't loop on every CI run.
    markOnboarded();
    return false;
  }

  const st = style();
  console.log("");
  console.log(`  ${st.brand("Welcome to Consilium.")}`);
  console.log(
    `  ${st.dim("Multiple AI models from different providers debate to solve your task.")}`,
  );
  console.log("");

  const cwd = process.cwd();
  const rootInfo = resolveProjectRoot(cwd);
  const workspace = detectWorkspace(rootInfo.root);

  const detected: string[] = [];
  if (workspace.language) detected.push(workspace.language);
  if (workspace.framework) detected.push(workspace.framework);
  if (workspace.packageManager) detected.push(workspace.packageManager);

  if (rootInfo.isGitRepo || detected.length > 0) {
    console.log(`  ${st.dim("I detected:")}`);
    if (rootInfo.isGitRepo)
      console.log(`    ${st.brand("•")} git repo at ${rootInfo.root}`);
    if (detected.length)
      console.log(`    ${st.brand("•")} ${detected.join(" / ")}`);
    if (workspace.hasTests)
      console.log(`    ${st.brand("•")} test suite present`);
    console.log("");
  }

  // 1. Codebase read consent. Only ask if we don't already have a stored grant.
  if (hasCodebasePermission(rootInfo.root) !== true) {
    console.log(`  ${st.bold("Codebase access")}`);
    console.log(
      `  ${st.dim("The council can read project files (Read/Grep/Glob/GitDiff) when answering.")}`,
    );
    console.log(
      `  ${st.dim("You can revoke at any time with /codebase revoke. No file is written without a separate prompt.")}`,
    );
    const answer = await ask(
      `  Allow codebase read for ${rootInfo.root}? [y/N] `,
    );
    if (answer === "y" || answer === "yes") {
      grantCodebasePermission(rootInfo.root, "always");
      console.log(
        `  ${st.success("Granted.")} ${st.dim("Stored in ~/.consilium/permissions.json")}`,
      );
    } else {
      console.log(
        `  ${st.dim("Skipped. The council will run without file tools until you grant.")}`,
      );
    }
    console.log("");
  }

  // 2. Show the one concrete next-action.
  console.log(`  ${st.bold("Try a debate")}`);
  console.log(
    `    ${st.brand("/auto")} ${st.dim("<your topic>")}    - engine picks the best mode`,
  );
  console.log(
    `    ${st.brand("/quick")} ${st.dim("<topic>")}        - single round, fastest`,
  );
  console.log(
    `    ${st.brand("/council")} ${st.dim("<topic>")}      - 3-round multi-model debate`,
  );
  console.log(
    `    ${st.brand("/help")}                - list every slash command`,
  );
  console.log("");
  console.log(
    `  ${st.dim("Bring your own keys via /config or sign in for the Consilium free-tier pool.")}`,
  );
  console.log("");

  markOnboarded();
  return true;
}
