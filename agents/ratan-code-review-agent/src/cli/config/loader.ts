import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  type ConfigProvider,
  type RootAgentConfig,
  RootAgentConfigSchema,
} from "agent-config-manager";
import { configureLogging } from "ratan-logger";
import { LocalConfigClient } from "./local-client";

const DEFAULT_CONFIG_DIR = ".ratan/code-review-agent";

interface RawWrapperConfig {
  mode: "local";
  ado: {
    organization: string;
    project: string;
    token?: string;
  };
  adoProxyUrl?: string;
  databaseUrl?: string;
  config?: RootAgentConfig;
}

function resolveEnvToken(value: string): string {
  const envMatch = value.match(/^env:(.+)$/);
  if (envMatch) {
    const envValue = process.env[envMatch[1]];
    if (!envValue) {
      throw new Error(
        `Environment variable "${envMatch[1]}" is not set. Check your config or set the ${envMatch[1]} environment variable.`,
      );
    }
    return envValue;
  }
  return value;
}

function resolveSecrets<T>(value: T): T {
  if (typeof value === "string") return resolveEnvToken(value) as T;
  if (Array.isArray(value)) return value.map(resolveSecrets) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, resolveSecrets(nested)]),
    ) as T;
  }
  return value;
}

export interface LoadConfigResult {
  provider: ConfigProvider;
  configDir: string;
}

export async function loadConfig(
  configPath?: string,
): Promise<LoadConfigResult> {
  const configDir = configPath
    ? path.resolve(configPath)
    : path.resolve(process.cwd(), DEFAULT_CONFIG_DIR);

  const configFile = path.resolve(configDir, "config.json");

  let raw: RawWrapperConfig;
  try {
    const content = await readFile(configFile, "utf-8");
    raw = JSON.parse(content) as RawWrapperConfig;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(
        `\n  Error: No config found at ${configFile}\n` +
        `  Run ratan-code-review start once to create a default .ratan folder.\n`
      );
      process.exit(1);
    }
    throw new Error(`Failed to parse ${configFile}: ${(err as Error).message}`);
  }

  if (raw.mode !== "local") {
    throw new Error(`Invalid mode "${raw.mode}" in ${configFile}. Only "local" is supported.`);
  }

  if (!raw.config) {
    throw new Error(`Missing "config" field in ${configFile}.`);
  }
  for (const key of ["agents", "defaultAgentConfig"] as const) {
    if (key in raw.config) {
      throw new Error(
        `Legacy config.${key} is no longer supported. Configure config.openCodeReview and create opencodereview/rule.json.`,
      );
    }
  }

  const resolved = resolveSecrets(raw);
  let config: RootAgentConfig;
  try {
    config = RootAgentConfigSchema.parse(resolved.config);
  } catch (err) {
    throw new Error(`Invalid configuration in ${configFile}: ${(err as Error).message}`);
  }
  const logging = config.logging;
  configureLogging({
    ...logging,
    directory: logging?.directory
      ? path.resolve(configDir, logging.directory)
      : path.resolve(configDir, "logs"),
  });
  const provider: ConfigProvider = new LocalConfigClient({
    configDir,
    config,
    ado: resolved.ado,
    adoToken: resolved.ado.token,
    adoProxyUrl: resolved.adoProxyUrl,
    databaseUrl: resolved.databaseUrl,
  });

  return { provider, configDir };
}
