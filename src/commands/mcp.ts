import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadConfig,
  DEFAULT_API_ORIGIN,
  DEFAULT_WEB_ORIGIN,
} from "../utils/config.js";
import { style } from "../utils/visual-system.js";

const st = style();

function pythonMcpModulePath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.normalize(
    path.join(
      here,
      "..",
      "..",
      "..",
      "packages",
      "python-sdk",
      "consilium",
      "mcp.py",
    ),
  );
}

export function mcpCommand(options: { json?: boolean }): void {
  const config = loadConfig();
  const apiUrl = (config.apiUrl || DEFAULT_API_ORIGIN).replace(/\/$/, "");
  const webUrl = (config.webUrl || DEFAULT_WEB_ORIGIN).replace(/\/$/, "");
  const mcpPy = pythonMcpModulePath();

  const rawKey = config.apiKey || "";
  const maskedKey =
    rawKey.length > 12
      ? rawKey.slice(0, 10) + "..." + rawKey.slice(-4)
      : rawKey || "<run consilium login first>";

  const envBlock = {
    CONSILIUM_API_URL: apiUrl,
    CONSILIUM_API_KEY: maskedKey,
  };

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          mcpServers: {
            consilium: {
              command: "python",
              args: ["-u", mcpPy],
              env: {
                CONSILIUM_API_URL: apiUrl,
                CONSILIUM_API_KEY: "${CONSILIUM_API_KEY}",
              },
            },
          },
          _comment:
            "Set CONSILIUM_API_KEY in your environment or replace with your consilium_ token (run: consilium login)",
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(st.brand("\nConsilium MCP (Model Context Protocol)\n"));
  console.log(
    st.dim(
      "The MCP server calls the same Nest API as the CLI using your CLI token.",
    ),
  );
  console.log(st.dim(`API base: ${apiUrl}`));
  console.log(st.dim(`Web app:  ${webUrl}\n`));

  console.log(st.bold("1. Auth"));
  console.log(st.dim("  Run: "), st.success("consilium login"));
  console.log(
    st.dim(
      "  Copy apiKey from ~/.consilium/config.json (starts with consilium_).\n",
    ),
  );

  console.log(st.bold("2. Environment for the MCP process"));
  console.log(st.dim(`  CONSILIUM_API_URL=${apiUrl}`));
  console.log(st.dim("  CONSILIUM_API_KEY=<your CLI token>\n"));

  console.log(st.bold("3. Dependencies"));
  console.log(
    st.dim(
      "  pip install httpx consilium  # from packages/python-sdk, or: pip install -e packages/python-sdk",
    ),
  );
  console.log(
    st.dim(
      "  pip install 'consilium[mcp]'          # optional: official MCP stdio server\n",
    ),
  );

  console.log(st.bold("4. Cursor / Claude Code (stdio)"));
  console.log(st.dim("  Add to your MCP config (merge mcpServers):\n"));
  console.log(
    JSON.stringify(
      {
        mcpServers: {
          consilium: {
            command: "python",
            args: ["-u", mcpPy],
            env: envBlock,
          },
        },
      },
      null,
      2,
    ),
  );
  console.log(
    st.dim(
      `\n  Module path above is relative to this repo: ${mcpPy}\n  On another machine, clone the repo or pip-install consilium and use: python -m consilium.mcp\n`,
    ),
  );

  console.log(st.bold("5. JSON only"));
  console.log(st.dim("  consilium mcp --json\n"));
}
