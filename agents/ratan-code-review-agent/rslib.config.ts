import { defineConfig } from "@rslib/core";

export default defineConfig({
  source: {
    entry: {
      index: "./src/index.ts",
      cli: "./src/cli/index.ts",
    },
  },
  lib: [
    {
      format: "esm",
      syntax: ["node 20"],
      dts: false,
    },
    {
      format: "cjs",
      syntax: ["node 20"],
    },
  ],
  output: {
    minify: false, // Better stack traces for CLI users
  },
});
