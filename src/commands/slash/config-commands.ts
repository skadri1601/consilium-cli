import type { ChatSession } from "../chat-session";
import type { SlashResult } from "./shared-state";
import { style } from "../../utils/visual-system";
import {
  DEFAULT_API_ORIGIN,
  DEFAULT_WEB_ORIGIN,
  loadConfig,
  updateConfig,
} from "../../utils/config";
import { openBrowser } from "../../utils/open-browser";
import {
  userHasStoredProviderKeys,
  type MaskedProviderKeys,
} from "../../utils/post-login-onboarding";
import {
  handleModeCommand,
  handleOutputCommand,
} from "../../utils/chat-commands";
import { checkAllConfiguredKeys } from "../../utils/key-validator";
import {
  KeyManager,
  PROVIDER_DISPLAY_NAMES,
  type Provider,
} from "../../utils/key-manager";
import {
  getPermissionSnapshot,
  requestWritePermission,
  revokeWritePermission,
} from "../../utils/codebase-permissions";
import { resolveProjectRoot } from "../../utils/project-root";

const st = style();

export function slashModels(args: string[], session: ChatSession): SlashResult {
  if (args.length > 0) {
    session.models = args;
    console.log(st.success("Models set:"), session.models.join(", "));
  } else {
    console.log(st.brand("Current models:"), session.models.join(", "));
  }
  return "continue";
}

export function slashApi(args: string[]): SlashResult {
  const sub = args[0]?.toLowerCase();
  const config = loadConfig();
  const webUrl =
    config.webUrl || process.env.CONSILIUM_WEB_URL || DEFAULT_WEB_ORIGIN;
  const settingsCliUrl = `${webUrl}/settings#cli`;

  if (sub === "set") {
    const key = args.slice(1).join(" ").trim() || (args[1] ?? "");
    if (!key) {
      console.log(st.warning("Usage: /api set <your-api-key>"));
      console.log(
        st.dim(
          "Get a key from the web app: Settings > CLI > Generate CLI token",
        ),
      );
      console.log(st.dim("Or run: /api open"));
      return "continue";
    }
    updateConfig("apiKey", key);
    console.log(st.success("API key saved. You can run debates now."));
    return "continue";
  }

  if (sub === "open") {
    console.log(st.brand("Opening web app to sign in and get CLI token..."));
    openBrowser(settingsCliUrl);
    console.log(st.success("Opened:"), settingsCliUrl);
    return "continue";
  }

  const apiKey = config.apiKey?.trim();
  console.log(st.bold("\nAPI Configuration\n"));
  console.log(st.brand("API URL:"), config.apiUrl || DEFAULT_API_ORIGIN);
  if (apiKey) {
    const masked =
      apiKey.length > 12
        ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`
        : "***";
    console.log(st.brand("API key:"), st.success("set"), st.dim(`(${masked})`));
  } else {
    console.log(st.brand("API key:"), st.warning("not set"));
    console.log(st.dim("  Set key: /api set <key>"));
    console.log(st.dim("  Get key: /api open (opens web app)"));
  }
  console.log("");
  return "continue";
}

export function slashMode(args: string[], session: ChatSession): SlashResult {
  const result = handleModeCommand(args, session.mode);
  if (result.changed) {
    session.mode = result.mode as ChatSession["mode"];
  }
  return "continue";
}

export function slashOutput(args: string[], session: ChatSession): SlashResult {
  const result = handleOutputCommand(args, session.outputFormat);
  if (result.changed) {
    session.outputFormat = result.format as ChatSession["outputFormat"];
  }
  return "continue";
}

export async function slashKeys(args: string[]): Promise<SlashResult> {
  const config = loadConfig();
  const webUrl =
    config.webUrl || process.env.CONSILIUM_WEB_URL || DEFAULT_WEB_ORIGIN;
  const keysUrl = `${webUrl.replace(/\/$/, "")}/settings#api-keys`;
  const sub = args[0]?.toLowerCase() ?? "open";

  if (sub === "open") {
    console.log(st.brand("Opening provider API keys in browser..."));
    openBrowser(keysUrl);
    console.log(st.success("Opened:"), keysUrl);
    console.log("");
    return "continue";
  }

  if (sub === "status") {
    const token = config.apiKey?.trim();
    const apiBase = (config.apiUrl || DEFAULT_API_ORIGIN).replace(/\/$/, "");
    if (!token) {
      console.log(
        st.warning("No CLI token. Run /api open or consilium login.\n"),
      );
      return "continue";
    }
    try {
      const res = await fetch(`${apiBase}/api/v1/api-keys`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        console.log(st.error(`Could not load key status (${res.status}).\n`));
        return "continue";
      }
      const keys = (await res.json()) as MaskedProviderKeys;
      const has = userHasStoredProviderKeys(keys);
      console.log(st.bold("\nProvider keys (account)\n"));
      if (has) {
        console.log(
          st.success("At least one provider key is saved."),
          st.dim("Manage at"),
        );
        console.log(st.brand(keysUrl));
      } else {
        console.log(
          st.warning("No provider keys saved."),
          st.dim("Debates can use platform Groq where supported."),
        );
        console.log(st.dim("Add keys:"), st.brand(keysUrl));
      }
      await printLocalKeyHealth();
      console.log("");
    } catch {
      console.log(st.error("Could not reach API for key status.\n"));
      await printLocalKeyHealth();
    }
    return "continue";
  }

  console.log(st.dim("Usage: /keys [open|status]"));
  console.log("");
  return "continue";
}

async function printLocalKeyHealth(): Promise<void> {
  const km = new KeyManager();
  const configured = km.getAvailableProviders();
  if (configured.length === 0) {
    console.log(
      st.dim("\nLocal provider keys: none in env or ~/.consilium/config.json"),
    );
    return;
  }
  console.log(st.bold("\nLocal provider keys (live health)"));
  let results: Awaited<ReturnType<typeof checkAllConfiguredKeys>> = [];
  try {
    results = await checkAllConfiguredKeys();
  } catch {
    results = [];
  }
  const byProvider = new Map(results.map((r) => [r.provider, r] as const));
  for (const provider of configured) {
    const label =
      (PROVIDER_DISPLAY_NAMES as Record<string, string | undefined>)[
        provider
      ] ?? provider;
    const result = byProvider.get(provider as Provider);
    if (!result) {
      console.log(`  ${label.padEnd(16)} ${st.dim("? unknown")}`);
      continue;
    }
    if (result.valid) {
      const count =
        typeof result.modelCount === "number"
          ? ` (${result.modelCount} models)`
          : "";
      console.log(
        `  ${label.padEnd(16)} ${st.success("✓ valid")}${st.dim(count)}`,
      );
    } else {
      const reason = result.error ? st.dim(` - ${result.error}`) : "";
      console.log(`  ${label.padEnd(16)} ${st.error("✗ invalid")}${reason}`);
    }
  }
}

export async function slashPermissions(args: string[]): Promise<SlashResult> {
  const rootInfo = resolveProjectRoot(process.cwd());
  const scopePath = rootInfo.root;
  const sub = (args[0] || "status").toLowerCase();

  if (sub === "allow-write") {
    const level = await requestWritePermission(scopePath);
    if (level === "deny") console.log(st.warning("Write permission denied."));
    else console.log(st.success(`Write permission granted: ${level}`));
    console.log("");
    return "continue";
  }

  if (sub === "revoke-write") {
    revokeWritePermission(scopePath);
    console.log(
      st.success("Revoked write permission for this project scope.\n"),
    );
    return "continue";
  }

  const snapshot = getPermissionSnapshot(scopePath);
  console.log(st.bold("\nPermission dashboard\n"));
  console.log(st.brand("Scope:"), snapshot.scopePath);
  console.log(st.brand("Read codebase:"), snapshot.readCodebase);
  console.log(st.brand("Write files:"), snapshot.writeFiles);
  console.log("");
  return "continue";
}
