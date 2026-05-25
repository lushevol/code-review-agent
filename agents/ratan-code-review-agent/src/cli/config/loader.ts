import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  type ConfigProvider,
  type RootAgentConfig,
  createAgentConfigClient,
} from "agent-config-manager";
import { LocalConfigClient } from "./local-client";

const DEFAULT_CONFIG_DIR = ".ratan/code-review-agent";

interface RawWrapperConfig {
  mode: "local" | "ado";
  ado: {
    organization: string;
    project: string;
    token?: string;
  };
  sonarQubeToken?: string;
  databaseUrl?: string;
  config?: RootAgentConfig;
  configRepo?: string;
  configBranch?: string;
  configBasePath?: string;
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

function resolveSecrets(raw: RawWrapperConfig): RawWrapperConfig {
  const resolved = { ...raw, ado: { ...raw.ado } };
  if (raw.ado.token) resolved.ado.token = resolveEnvToken(raw.ado.token);
  if (raw.sonarQubeToken) resolved.sonarQubeToken = resolveEnvToken(raw.sonarQubeToken);
  if (raw.databaseUrl) resolved.databaseUrl = resolveEnvToken(raw.databaseUrl);
  return resolved;
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
        `  Create one with: ratan-code-review init\n`
      );
      process.exit(1);
    }
    throw new Error(`Failed to parse ${configFile}: ${(err as Error).message}`);
  }

  if (raw.mode !== "local" && raw.mode !== "ado") {
    throw new Error(`Invalid mode "${raw.mode}" in ${configFile}. Must be "local" or "ado".`);
  }

  const resolved = resolveSecrets(raw);

  let provider: ConfigProvider;

  if (resolved.mode === "local") {
    if (!resolved.config) {
      throw new Error(
        `Missing "config" field in ${configFile}. In local mode, the config must be inline.`,
      );
    }
    provider = new LocalConfigClient({
      configDir,
      config: resolved.config,
      ado: resolved.ado,
      adoToken: resolved.ado.token,
      sonarQubeToken: resolved.sonarQubeToken,
      databaseUrl: resolved.databaseUrl,
    });
  } else {
    // ADO mode
    if (!resolved.configRepo || !resolved.configBranch) {
      throw new Error(
        `Missing "configRepo" or "configBranch" in ${configFile}. These are required in ADO mode.`,
      );
    }
    provider = await createAgentConfigClient({
      adoToken: resolved.ado.token || "",
      organization: resolved.ado.organization,
      project: resolved.ado.project,
      repoName: resolved.configRepo,
      branch: resolved.configBranch,
      basePath: resolved.configBasePath,
      sonarQubeToken: resolved.sonarQubeToken,
      ormConnectionUrl: resolved.databaseUrl,
    });
  }

  return { provider, configDir };
}
