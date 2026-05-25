import { parseArgs } from "node:util";
import type { AgentConfigCreationOptions } from "agent-config-manager";

export type CliCommand =
  | { command: "help" }
  | { command: "run"; options: AgentConfigCreationOptions }
  | { command: "doctor"; options: AgentConfigCreationOptions };

type CliEnv = Record<string, string | undefined>;

const optionConfig = {
  "ado-token": { type: "string" },
  "sonarqube-token": { type: "string" },
  "database-url": { type: "string" },
  organization: { type: "string" },
  project: { type: "string" },
  "ado-proxy-url": { type: "string" },
  "config-repo": { type: "string" },
  "config-branch": { type: "string" },
  "config-base-path": { type: "string" },
  "refresh-interval-ms": { type: "string" },
  help: { type: "boolean", short: "h" },
} as const;

const requiredEnvNames = [
  "ADO_TOKEN",
  "ADO_CONFIG_REPO",
  "ADO_CONFIG_BRANCH",
] as const;

const firstString = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value.at(-1) : value;

const optionalNumber = (name: string, value: string | undefined) => {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number.`);
  }
  return parsed;
};

export const parseCliArgs = (
  argv: string[] = process.argv.slice(2),
  env: CliEnv = process.env,
): CliCommand => {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    options: optionConfig,
  });

  const command = parsed.positionals[0];
  if (parsed.values.help || !command) {
    return { command: "help" };
  }

  if (command !== "run" && command !== "doctor") {
    throw new Error(`Unknown command: ${command}`);
  }

  const adoToken = firstString(parsed.values["ado-token"]) ?? env.ADO_TOKEN;
  const repoName =
    firstString(parsed.values["config-repo"]) ?? env.ADO_CONFIG_REPO;
  const branch =
    firstString(parsed.values["config-branch"]) ?? env.ADO_CONFIG_BRANCH;

  const missing = [
    !adoToken && requiredEnvNames[0],
    !repoName && requiredEnvNames[1],
    !branch && requiredEnvNames[2],
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(", ")}`);
  }

  return {
    command,
    options: {
      adoToken,
      sonarQubeToken:
        firstString(parsed.values["sonarqube-token"]) ?? env.SONARQUBE_TOKEN,
      ormConnectionUrl:
        firstString(parsed.values["database-url"]) ?? env.DATABASE_URL,
      organization:
        firstString(parsed.values.organization) ?? env.ADO_ORGANIZATION,
      project: firstString(parsed.values.project) ?? env.ADO_PROJECT,
      adoProxyUrl:
        firstString(parsed.values["ado-proxy-url"]) ?? env.ADO_PROXY_URL,
      repoName,
      branch,
      basePath:
        firstString(parsed.values["config-base-path"]) ??
        env.ADO_CONFIG_BASE_PATH,
      refreshIntervalMs: optionalNumber(
        "refresh-interval-ms",
        firstString(parsed.values["refresh-interval-ms"]) ??
          env.ADO_CONFIG_REFRESH_INTERVAL_MS,
      ),
    },
  };
};

export const renderHelp = () => `Usage:
  ratan-code-review-agent run [options]
  ratan-code-review-agent doctor [options]

Runs the Azure DevOps pull request review agent. This command scans ADO pull
requests and can post review comments.

The doctor command connects to Azure DevOps and loads config.json without
scanning PRs or posting comments.

Required configuration:
  --ado-token <token>          or ADO_TOKEN
  --config-repo <repo>         or ADO_CONFIG_REPO
  --config-branch <branch>     or ADO_CONFIG_BRANCH

Options:
  --organization <name>        or ADO_ORGANIZATION
  --project <name>             or ADO_PROJECT
  --ado-proxy-url <url|none>   or ADO_PROXY_URL
  --config-base-path <path>    or ADO_CONFIG_BASE_PATH
  --sonarqube-token <token>    or SONARQUBE_TOKEN
  --database-url <url>         or DATABASE_URL
  --refresh-interval-ms <ms>   or ADO_CONFIG_REFRESH_INTERVAL_MS
  -h, --help                   Show this help message
`;
