import readline from "node:readline";
import {
  DEFAULT_API_ORIGIN,
  DEFAULT_WEB_ORIGIN,
  loadConfig,
  saveConfig,
  isLoggedIn,
  fetchAndCachePreferences,
} from "../utils/config.js";
import { openBrowser } from "../utils/open-browser.js";
import { printPostLoginProviderHints } from "../utils/post-login-onboarding.js";
import { style } from "../utils/visual-system.js";

const st = style();

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    let answered = false;
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(answer);
    });
    rl.on("close", () => {
      if (!answered) resolve("");
    });
  });
}

function stripQuotes(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

export async function loginFlow(): Promise<boolean> {
  console.log(
    st.brand(
      "\n╔══════════════════════════════════════╗\n║       Welcome to Consilium          ║\n╚══════════════════════════════════════╝",
    ),
  );

  const config = loadConfig();
  const webUrl = (config.webUrl ?? DEFAULT_WEB_ORIGIN).replace(/\/$/, "");
  const apiUrl = (config.apiUrl ?? DEFAULT_API_ORIGIN).replace(/\/$/, "");
  const authUrl = `${webUrl}/cli/auth`;

  console.log(st.dim("\nOpening Consilium in your browser..."));
  openBrowser(authUrl);
  console.log(st.dim(`(If it doesn't open, go to: ${authUrl})`));
  console.log("");
  console.log("Waiting for authentication...");

  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    const raw = await prompt("Paste your CLI token here: ");
    const token = stripQuotes(raw.trim());

    if (!token) {
      console.log(st.warning("Login cancelled."));
      return false;
    }

    if (!token.startsWith("consilium_") || token.length < 20) {
      attempts++;
      if (attempts >= maxAttempts) {
        console.log(
          st.error("Invalid token format. Token should start with consilium_"),
        );
        return false;
      }
      console.log(
        st.warning("Invalid token format. Token should start with consilium_"),
      );
      continue;
    }

    let res: Response;
    try {
      res = await fetch(`${apiUrl}/api/v1/users/me`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      console.log(
        st.error(`Cannot connect to API at ${apiUrl}. Is the server running?`),
      );
      return false;
    }

    if (res.status === 401 || res.status === 403) {
      attempts++;
      if (attempts >= maxAttempts) {
        console.log(st.error("Invalid or expired token. Please try again."));
        return false;
      }
      console.log(st.warning("Invalid or expired token. Please try again."));
      continue;
    }

    const data = (await res.json()) as Record<string, string>;
    const firstName = data.firstName || "";
    const lastName = data.lastName || "";
    const email = data.email || "";
    const userName = `${firstName} ${lastName}`.trim();

    saveConfig({
      ...loadConfig(),
      apiKey: token,
      userName,
      userEmail: email,
    });

    console.log(st.success(`\n✓ Logged in as ${userName} (${email})`));
    const prefs = await fetchAndCachePreferences();
    if (prefs) {
      console.log(
        st.dim(
          `  Synced preferences: ${prefs.defaultAgents.length} default models, mode=${prefs.defaultMode}`,
        ),
      );
    }
    await printPostLoginProviderHints(apiUrl, token, webUrl);
    return true;
  }

  return false;
}

export async function loginCommand(options?: {
  force?: boolean;
}): Promise<void> {
  if (isLoggedIn() && !options?.force) {
    const config = loadConfig();
    console.log(
      `Already logged in as ${config.userName || "unknown"} (${config.userEmail || "unknown"}). Use --force to re-authenticate or \`consilium logout\` first.`,
    );
    return;
  }
  await loginFlow();
}
