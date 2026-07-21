import { defineConfig } from "@rslib/core";

const npmExternals = {
  zod: "zod",
  "redact-pii": "redact-pii",
  picomatch: "picomatch",
  "js-yaml": "js-yaml",
  "@hono/node-server": "@hono/node-server",
  hono: "hono",
  "ratan-logger": "ratan-logger",
  "@alibaba-group/open-code-review": "@alibaba-group/open-code-review",
};

export default defineConfig({
  source: {
    tsconfigPath: "./tsconfig.dts.json",
    entry: {
      index: "./src/index.ts",
      cli: "./src/cli/index.ts",
    },
  },
  lib: [
    {
      format: "esm",
      syntax: ["node 20"],
      output: { externals: npmExternals },
      // Polyfill __dirname for libraries bundled into ESM output
      // (e.g. azure-devops-node-api WebApi constructor uses it)
      shims: { esm: { __dirname: true } },
    },
    {
      format: "cjs",
      syntax: ["node 20"],
      output: {
        externals: Object.fromEntries(
          Object.entries(npmExternals).map(([k, v]) => [k, `commonjs2 ${v}`]),
        ),
      },
    },
  ],
  output: {
    minify: false, // Better stack traces for CLI users
  },
  // Prevent workspace packages (agent-config-manager, ratan-ado-api, etc.) from
  // being auto-externalized so config schema changes ship in the same tarball.
  autoExternal: {
    dependencies: false,
  },
});
