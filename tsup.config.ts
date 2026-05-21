import { defineConfig } from "tsup";
import { builtinModules } from "node:module";

const nodeBuiltins = builtinModules.flatMap((m) => [m, `node:${m}`]);

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  noExternal: [/@consilium/],
  external: nodeBuiltins,
  banner: {
    js: `import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);`,
  },
});
