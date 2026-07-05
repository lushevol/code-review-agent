#!/usr/bin/env node
// CJS wrapper — sets env before ESM imports evaluate
process.env.DOTENV_CONFIG_QUIET = "true";
import("../dist/cli.js").catch((e) => {
  console.error(e);
  process.exit(1);
});
