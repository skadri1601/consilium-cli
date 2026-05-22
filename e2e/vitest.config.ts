import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    root: here,
    include: ["**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: "threads",
    minWorkers: 1,
    maxWorkers: 1,
    fileParallelism: false,
    isolate: true,
    globalSetup: [path.join(here, "helpers/global-setup.ts")],
    coverage: {
      enabled: false,
    },
  },
});
