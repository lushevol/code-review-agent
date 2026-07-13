#!/usr/bin/env node

// Suppress dotenv@17 "injected env" banner messages
process.env.DOTENV_CONFIG_QUIET = "true";

import { Command } from "commander";
import { startCommand } from "./commands/start";
import { startDashboard } from "./commands/dashboard";

const packageJson = await import("../../package.json", { with: { type: "json" } });

const program = new Command();

program
  .name("ratan-code-review")
  .description("AI-powered code review agent for Azure DevOps")
  .version(packageJson.default?.version ?? packageJson.version ?? "0.0.1");

program
  .command("start")
  .description(
    "Start the code review agent — creates .ratan folder on first run, scans repos, processes PRs. Runs feedback daemon (ADO comment sync) automatically in --watch mode.",
  )
  .option("--config <path>", "Config directory path (default: .ratan)")
  .option(
    "--pr-id <number>",
    "Review a specific pull request ID",
    (value) => Number.parseInt(value, 10),
  )
  .option("--watch", "Keep running: scan every 30 min + background feedback sync")
  .option(
    "--repo-pattern <patterns...>",
    "Repo name glob patterns to scan (e.g. 'my-team-*')",
  )
  .action(async (opts) => {
    await startCommand({
      config: opts.config,
      watch: opts.watch,
      prId: opts.prId,
      repoPatterns: opts.repoPattern,
    });
  });

program
  .command("dashboard")
  .description("Start the PR Guardian dashboard with PR queue management")
  .option("--port <number>", "Port for the dashboard server")
  .option("--config <path>", "Config directory path (default: .ratan)")
  .option(
    "--finding-store <path>",
    "Path to the FindingStore SQLite database",
  )
  .action(async (opts) => {
    await startDashboard({
      port: opts.port ? Number(opts.port) : undefined,
      findingStorePath: opts.findingStore,
      config: opts.config,
    });
  });

program.parse(process.argv);
