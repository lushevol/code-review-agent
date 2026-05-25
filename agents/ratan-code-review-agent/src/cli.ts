#!/usr/bin/env node
import type { startup as startupFn } from "./bootstrap/index";
import { runCli } from "./cli-runner";

const startAgent: typeof startupFn = async (...args) => {
  const { startup } = await import("./bootstrap/index");
  return startup(...args);
};

const checkConfig: typeof startupFn = async (options) => {
  const { createAgentConfigClient } = await import("agent-config-manager");
  const client = await createAgentConfigClient(options);
  await client.getRootConfig();
};

process.exitCode = await runCli({ startAgent, checkConfig });
