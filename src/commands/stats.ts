import { ConsiliumClient } from "../api/client";
import { requireAuth } from "../utils/require-auth";
import { loadConfig, DEFAULT_API_ORIGIN } from "../utils/config";
import {
  style,
  border,
  borderBottom,
  contentLine,
} from "../utils/visual-system";

const st = style();

interface StatsResponse {
  totalDebates: number;
  totalCost: number;
  thisMonthCount: number;
  avgCost: number;
  modelUsage: Record<string, number>;
}

function formatCost(cost: number | undefined): string {
  if (cost === undefined || cost === null) return "$0.00";
  return `$${cost.toFixed(4)}`;
}

type FetchStatsResult =
  | { ok: true; data: StatsResponse }
  | {
      ok: false;
      reason: "unauthorized" | "unreachable" | "server_error";
      status?: number;
      detail?: string;
    };

async function fetchStats(_client: ConsiliumClient): Promise<FetchStatsResult> {
  const config = loadConfig();
  const apiUrl = config.apiUrl || DEFAULT_API_ORIGIN;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

  try {
    const response = await fetch(`${apiUrl}/api/v1/analytics/stats`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: "unauthorized", status: response.status };
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        ok: false,
        reason: "server_error",
        status: response.status,
        detail,
      };
    }
    const data = (await response.json()) as StatsResponse;
    return { ok: true, data };
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "unreachable", detail };
  }
}

export async function statsCommand(): Promise<void> {
  await requireAuth();

  const client = new ConsiliumClient();
  const result = await fetchStats(client);

  if (!result.ok) {
    if (result.reason === "unauthorized") {
      console.log(st.error("Stats unavailable: not authorized."));
      console.log(st.dim("  Run `consilium login` to refresh your CLI token."));
      return;
    }
    if (result.reason === "unreachable") {
      console.log(st.error("Stats unavailable: API not reachable."));
      console.log(st.dim(`  ${result.detail ?? ""}`));
      console.log(
        st.dim("  Check `consilium config get apiUrl` and that the API is up."),
      );
      return;
    }
    console.log(st.error(`Stats unavailable: API returned ${result.status}.`));
    if (result.detail) console.log(st.dim(`  ${result.detail}`));
    return;
  }

  const stats = result.data;

  console.log(border("Model Performance Dashboard"));
  console.log(contentLine(`Total Debates:     ${stats.totalDebates}`));
  console.log(contentLine(`Total Cost:        ${formatCost(stats.totalCost)}`));
  console.log(contentLine(`This Month:        ${stats.thisMonthCount}`));
  console.log(contentLine(`Avg Cost/Debate:   ${formatCost(stats.avgCost)}`));
  console.log(borderBottom());

  const modelUsage = stats.modelUsage || {};
  const models = Object.entries(modelUsage).sort((a, b) => b[1] - a[1]);

  if (models.length > 0) {
    console.log("");
    console.log(border("Model Usage Breakdown"));
    const top = models[0];
    const maxCount = top ? top[1] : 0;
    for (const [model, count] of models) {
      const barLen = maxCount > 0 ? Math.round((count / maxCount) * 20) : 0;
      const bar = "\u2588".repeat(barLen) + "\u2591".repeat(20 - barLen);
      console.log(contentLine(`${model.padEnd(20)} ${bar} ${count}`));
    }
    console.log(borderBottom());
  }
}
