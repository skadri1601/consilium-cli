import { style } from "./visual-system";

const st = style();

export type MaskedProviderKeys = {
  openaiKey?: string | null;
  anthropicKey?: string | null;
  googleKey?: string | null;
  groqKey?: string | null;
  xaiKey?: string | null;
};

export function userHasStoredProviderKeys(keys: MaskedProviderKeys): boolean {
  return (
    (keys.openaiKey != null && keys.openaiKey !== "") ||
    (keys.anthropicKey != null && keys.anthropicKey !== "") ||
    (keys.googleKey != null && keys.googleKey !== "") ||
    (keys.groqKey != null && keys.groqKey !== "") ||
    (keys.xaiKey != null && keys.xaiKey !== "")
  );
}

export async function printPostLoginProviderHints(
  apiUrl: string,
  token: string,
  webUrl: string,
): Promise<void> {
  const base = apiUrl.replace(/\/$/, "");
  const keysPage = `${webUrl.replace(/\/$/, "")}/settings#api-keys`;
  try {
    const res = await fetch(`${base}/api/v1/api-keys`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return;
    const keys = (await res.json()) as MaskedProviderKeys;
    if (userHasStoredProviderKeys(keys)) {
      console.log(
        st.dim(
          "\nProvider LLM keys are saved on your account (values are never shown in full).",
        ),
      );
      console.log(st.dim(`Add or change keys: ${keysPage}\n`));
    } else {
      console.log(st.brand("\n── Provider keys ──"));
      console.log(
        st.dim("No provider keys saved yet. Debates can still run on "),
        st.success("Consilium-managed Groq"),
        st.dim(" where the platform supplies the model (shared limits)."),
      );
      console.log(
        st.dim(
          "To use your own OpenAI, Anthropic, Google, Groq, or xAI keys in the web app, CLI, and MCP:",
        ),
      );
      console.log(st.brand(`  ${keysPage}`));
      console.log(st.dim("In chat, use /keys open or /keys status.\n"));
    }
  } catch {
    return;
  }
}
