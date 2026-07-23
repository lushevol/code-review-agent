import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type ConfigProvider,
  type RootAgentConfig,
  RootAgentConfigSchema,
} from "agent-config-manager";
import { configureLogging } from "ratan-logger";
import { LocalConfigClient } from "./local-client";
import { repairConfig, repairConfigInteractive } from "./migration";

const DEFAULT_CONFIG_DIR = ".ratan";

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

  try {
    const content = await readFile(configFile, "utf-8");
    const raw = JSON.parse(content) as Record<string, unknown>;

    // ── Config integrity check & repair ────────────────────────────────
    const isInteractive = process.stdin.isTTY ?? false;
    const repairResult = isInteractive
      ? await repairConfigInteractive(raw, configFile)
      : repairConfig(raw);

    if (repairResult.modified && !isInteractive) {
      await writeFile(configFile, JSON.stringify(repairResult.config, null, 2) + "\n", "utf-8");
    }
    for (const w of repairResult.warnings) {
      console.warn(`  ⚙ ${w}`);
    }

    const resolved = resolveSecrets(repairResult.config);
    let config: RootAgentConfig;
    try {
      config = RootAgentConfigSchema.parse(resolved);
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
    });

    return { provider, configDir };
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
}
