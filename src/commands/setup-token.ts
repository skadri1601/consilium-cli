import {
  DEFAULT_API_ORIGIN,
  DEFAULT_WEB_ORIGIN,
  isLoggedIn,
  loadConfig,
} from "../utils/config.js";
import { style } from "../utils/visual-system.js";

const st = style();

interface SetupTokenOptions {
  name?: string;
  days?: number | string;
  print?: boolean;
}

interface CliTokenResponse {
  token?: string;
  apiKey?: string;
  value?: string;
  expiresAt?: string;
  name?: string;
}

function parseDays(raw: number | string | undefined): number {
  if (raw === undefined) return 365;
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 365;
  }
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 365;
  return parsed;
}

function printInstructions(webUrl: string, days: number): void {
  console.log(
    st.warning(
      "\n  Long-lived CLI tokens endpoint is not yet enabled on this API.",
    ),
  );
  console.log("");
  console.log(
    `  Visit ${st.brand(`${webUrl}/settings#cli-tokens`)} to generate a CI token.`,
  );
  console.log(
    st.dim(
      `  Choose a lifetime of ${days} days (default 365) and copy the value.`,
    ),
  );
  console.log("");
  console.log(st.dim("  Then export it in your CI environment:"));
  console.log(st.brand("    export CONSILIUM_API_KEY=consilium_..."));
  console.log("");
}

function printTokenBox(
  token: string,
  name: string | undefined,
  days: number,
): void {
  const label = name ? ` (label: ${name})` : "";
  console.log("");
  console.log(
    st.success(`✓ Generated CI token${label}, valid for ${days} days.`),
  );
  console.log("");
  console.log(
    "  ┌─────────────────────────────────────────────────────────────┐",
  );
  console.log(`  │  ${st.bold(token)}`);
  console.log(
    "  └─────────────────────────────────────────────────────────────┘",
  );
  console.log("");
  console.log(st.dim("  Store it now — you will not see it again."));
  console.log("");
  console.log(st.dim("  Use it in CI / scripts:"));
  console.log(st.brand(`    export CONSILIUM_API_KEY=${token}`));
  console.log("");
}

export async function setupTokenCommand(
  opts: SetupTokenOptions = {},
): Promise<void> {
  if (!isLoggedIn()) {
    console.log(st.error("Not logged in. Run `consilium login` first."));
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  const apiUrl = (config.apiUrl ?? DEFAULT_API_ORIGIN).replace(/\/$/, "");
  const webUrl = (config.webUrl ?? DEFAULT_WEB_ORIGIN).replace(/\/$/, "");
  const days = parseDays(opts.days);
  const name = opts.name;
  const printOnly = Boolean(opts.print);

  let res: Response;
  try {
    res = await fetch(`${apiUrl}/api/v1/auth/cli-tokens`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, ttlDays: days }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    console.log(st.error(`Cannot connect to API at ${apiUrl}.`));
    if (!printOnly) printInstructions(webUrl, days);
    process.exitCode = 1;
    return;
  }

  if (res.status === 404) {
    if (printOnly) {
      console.error(
        `Endpoint not available. Generate manually at ${webUrl}/settings#cli-tokens`,
      );
      process.exitCode = 1;
      return;
    }
    printInstructions(webUrl, days);
    return;
  }

  if (res.status === 401 || res.status === 403) {
    console.log(
      st.error(
        "Authentication failed. Run `consilium login` to refresh your token.",
      ),
    );
    process.exitCode = 1;
    return;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.log(
      st.error(
        `Failed to create token (status ${res.status}). ${body.slice(0, 200)}`,
      ),
    );
    process.exitCode = 1;
    return;
  }

  let data: CliTokenResponse;
  try {
    data = (await res.json()) as CliTokenResponse;
  } catch {
    console.log(
      st.error("Unexpected response from API (could not parse JSON)."),
    );
    process.exitCode = 1;
    return;
  }

  const token = data.token ?? data.apiKey ?? data.value;
  if (!token) {
    console.log(st.error("API did not return a token value."));
    process.exitCode = 1;
    return;
  }

  if (printOnly) {
    process.stdout.write(token + "\n");
    return;
  }

  printTokenBox(token, data.name ?? name, days);
}
