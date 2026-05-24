import { defineConfig } from "@rslib/core";

export default defineConfig({
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
    minify: true,
  },
});
