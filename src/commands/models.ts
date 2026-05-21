import {
  CatalogEntry,
  DEFAULT_BLIND_EVAL_MODELS,
  DEFAULT_MODELS,
  MODEL_CATALOG,
  isDeprecatedOrRetired,
} from "../utils/default-models";
import { style } from "../utils/visual-system";

const st = style();

export interface ModelsCommandOptions {
  json?: boolean;
  check?: boolean;
}

function statusBadge(status: CatalogEntry["status"]): string {
  switch (status) {
    case "current":
      return st.success("current");
    case "preview":
      return st.warning("preview");
  }
}

function checkUserModels(): {
  id: string;
  status: CatalogEntry["status"];
  notes?: string;
}[] {
  const flagged: {
    id: string;
    status: CatalogEntry["status"];
    notes?: string;
  }[] = [];
  const ids = new Set([...DEFAULT_MODELS, ...DEFAULT_BLIND_EVAL_MODELS]);
  for (const id of ids) {
    if (isDeprecatedOrRetired(id)) {
      const entry = MODEL_CATALOG.find((e) => e.id === id);
      if (entry) flagged.push({ id, status: entry.status, notes: entry.notes });
    }
  }
  return flagged;
}

export function modelsCommand(options: ModelsCommandOptions = {}): void {
  if (options.check) {
    const flagged = checkUserModels();
    if (options.json) {
      console.log(JSON.stringify({ deprecated: flagged }, null, 2));
      return;
    }
    if (flagged.length === 0) {
      console.log(st.success("All default models are current. ✓"));
      return;
    }
    console.log(
      st.warning(
        `\n${flagged.length} default model${flagged.length === 1 ? "" : "s"} need attention:\n`,
      ),
    );
    for (const f of flagged) {
      console.log(`  ${st.brand(f.id)} - ${statusBadge(f.status)}`);
      if (f.notes) console.log(st.dim(`    ${f.notes}`));
    }
    console.log("");
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          defaults: DEFAULT_MODELS,
          blindEvalDefaults: DEFAULT_BLIND_EVAL_MODELS,
          catalog: MODEL_CATALOG,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(st.bold("\nDefault models (debate / council / benchmark):"));
  for (const id of DEFAULT_MODELS) {
    console.log(st.brand(`  • ${id}`));
  }

  console.log(st.bold("\nDefault models (blind eval):"));
  for (const id of DEFAULT_BLIND_EVAL_MODELS) {
    console.log(st.brand(`  • ${id}`));
  }

  console.log(st.bold("\nCatalog:"));
  const byProvider = new Map<string, CatalogEntry[]>();
  for (const entry of MODEL_CATALOG) {
    const list = byProvider.get(entry.provider) ?? [];
    list.push(entry);
    byProvider.set(entry.provider, list);
  }
  for (const [provider, entries] of byProvider) {
    console.log(st.dim(`\n  ${provider}`));
    for (const entry of entries) {
      const tail = entry.notes ? st.dim(`  - ${entry.notes}`) : "";
      console.log(
        `    ${entry.id.padEnd(34)} ${statusBadge(entry.status).padEnd(20)} ${st.dim(entry.tier)}${tail}`,
      );
    }
  }

  console.log("");
  console.log(
    st.dim(
      "  Override per command with -m / --models, e.g. consilium debate 'x' -m gpt-5.4 claude-sonnet-4-6",
    ),
  );
  console.log(
    st.dim(
      "  Audit your defaults: consilium models --check    Raw list: consilium models --json",
    ),
  );
  console.log("");
}
