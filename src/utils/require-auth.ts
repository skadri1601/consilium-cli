import { isLoggedIn } from "./config";
import { loginFlow } from "../commands/login";

export async function requireAuth(): Promise<void> {
  if (isLoggedIn()) return;
  const success = await loginFlow();
  if (!success) process.exit(1);
}
