#!/usr/bin/env node

// Suppress dotenv@17 "injected env" banner messages
process.env.DOTENV_CONFIG_QUIET = "true";

import { startCommand } from "./commands/start";
import { startDashboard } from "./commands/dashboard";

const pkg = await import("../../package.json", { with: { type: "json" } });
const APP_VERSION = pkg.default?.version ?? pkg.version ?? "0.0.1";

function printHelp(): void {
  console.log(
    `ratan-code-review v${APP_VERSION}

Usage: ratan-code-review [options] [command]

AI-powered code review agent for Azure DevOps

Options:
  -V, --version   output the version number
  -h, --help      display help for command

Commands:
  start           Start the code review agent — creates .ratan folder on first run, scans repos, processes PRs. Runs feedback daemon (ADO comment sync) automatically in --watch mode.
    --config <path>          Config directory path (default: .ratan)
    --pr-id <number>         Review a specific pull request ID
    --watch                  Keep running: scan every 30 min + background feedback sync
    --repo-pattern <patterns...>    Repo name glob patterns to scan (e.g. 'my-team-*')

  dashboard       Start the PR Guardian dashboard with PR queue management
    --port <number>          Port for the dashboard server
    --config <path>          Config directory path (default: .ratan)
    --finding-store <path>   Path to the FindingStore SQLite database

Cheatsheet:
  ratan-code-review start                    Scaffold .ratan and scan eligible PRs
  ratan-code-review start --pr-id 123        Review one PR and wait for the result
  ratan-code-review start --watch            Scan every 30 min and sync feedback
  ratan-code-review dashboard --port 3000    Open the dashboard on port 3000
`,
  );
}

// --- Parse process.argv ---

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  printHelp();
  process.exit(0);
}

if (args[0] === "--version" || args[0] === "-V") {
  console.log(`ratan-code-review v${APP_VERSION}`);
  process.exit(0);
}

const command = args[0];
const flagArgs = args.slice(1);

// Subcommand help
if (flagArgs.includes("--help") || flagArgs.includes("-h")) {
  printHelp();
  process.exit(0);
}

// Parse remaining --flag value pairs
const flags: Record<string, unknown> = {};

let i = 0;
while (i < flagArgs.length) {
  const arg = flagArgs[i];
  if (!arg.startsWith("--")) {
    i++;
    continue;
  }

  const name = arg.slice(2);

  if (name === "watch") {
    flags[name] = true;
    i++;
  } else if (name === "repo-pattern") {
    i++;
    const values: string[] = [];
    while (i < flagArgs.length && !flagArgs[i].startsWith("--")) {
      values.push(flagArgs[i]);
      i++;
    }
    flags[name] = values;
  } else {
    // Value-required flags: config, pr-id, port, finding-store
    i++;
    if (i >= flagArgs.length) {
      console.error(`error: option '--${name}' requires a value`);
      process.exit(1);
    }
    flags[name] = name === "pr-id" || name === "port" ? Number(flagArgs[i]) : flagArgs[i];
    i++;
  }
}

// Dispatch
if (command === "start") {
  await startCommand({
    config: flags.config as string | undefined,
    watch: flags.watch as boolean | undefined,
    prId: flags["pr-id"] as number | undefined,
    repoPatterns: flags["repo-pattern"] as string[] | undefined,
  });
} else if (command === "dashboard") {
  await startDashboard({
    port: flags.port as number | undefined,
    findingStorePath: flags["finding-store"] as string | undefined,
    config: flags.config as string | undefined,
  });
} else {
  console.error(`error: unknown command '${command}'. See 'ratan-code-review --help'.`);
  process.exit(1);
}
