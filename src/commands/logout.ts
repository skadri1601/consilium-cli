import { loadConfig, clearAuth, isLoggedIn } from "../utils/config.js";
import { style } from "../utils/visual-system.js";

const st = style();

export function logoutCommand(): void {
  if (!isLoggedIn()) {
    console.log("Not logged in.");
    return;
  }
  const { userName } = loadConfig();
  clearAuth();
  console.log(
    st.success(
      `✓ Logged out${userName ? ` (${userName})` : ""}. Run \`consilium\` to sign in again.`,
    ),
  );
}
