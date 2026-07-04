#!/usr/bin/env node

import { Command } from "commander";
import path from "node:path";
import { scan } from "./commands/scan";
import { studio } from "./commands/studio";
import { init } from "./commands/init";
import { startDashboard } from "./commands/dashboard";
import { overrideCommand } from "./commands/override";
import { feedbackCommand } from "./commands/feedback";

const packageJson = await import("../../package.json", { with: { type: "json" } });

const program = new Command();

program
  .name("ratan-code-review")
  .description("AI-powered code review agent for Azure DevOps")
  .version(packageJson.default?.version ?? packageJson.version ?? "0.0.1");

program
  .command("init")
  .description("Scaffold .ratan/code-review-agent/config.json with defaults")
  .option("--config <path>", "Config directory path")
  .action(async (opts) => {
    const configDir = opts.config
      ? path.resolve(opts.config)
      : path.resolve(process.cwd(), ".ratan/code-review-agent");
    await init(configDir);
  });

program
  .command("scan")
  .description("Scan and review pull requests")
  .option("--config <path>", "Config directory path")
  .option("--pr-id <number>", "Review a specific pull request ID", (value) =>
    Number.parseInt(value, 10),
  )
  .option("--watch", "Keep running and scan every 30 minutes")
  .option("--mode <mode>", 'Run mode: "service" for webhook-based continuous review')
  .option("--feedback-daemon", "Run the feedback daemon independently")
  .action(async (opts) => {
    await scan({
      config: opts.config,
      watch: opts.watch,
      prId: opts.prId,
      mode: opts.mode,
      feedbackDaemon: opts.feedbackDaemon,
    });
  });

program
  .command("studio")
  .description("Launch Mastra Studio web UI")
  .option("--config <path>", "Config directory path")
  .option("--port <number>", "Port to run the studio on")
  .action(async (opts) => {
    await studio({ config: opts.config, port: opts.port ? Number(opts.port) : undefined });
  });

program
  .command("dashboard")
  .description("Start the PR Guardian dashboard server")
  .option("--port <number>", "Port for the dashboard server")
  .option("--finding-store <path>", "Path to the FindingStore SQLite database")
  .action(async (opts) => {
    await startDashboard({
      port: opts.port ? Number(opts.port) : undefined,
      findingStorePath: opts.findingStore,
    });
  });

overrideCommand(program);
feedbackCommand(program);

program.parse(process.argv);
