import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ConfigProvider, RootAgentConfig } from "agent-config-manager";
import { getLogger } from "ratan-logger";

const execFileAsync = promisify(execFile);

const LLM_HEALTH_CHECK_TIMEOUT_MS = 5_000;

// ─── Types ───────────────────────────────────────────────────────────────────

export type ReadinessStatus = "ok" | "fail" | "skip";

export interface ReadinessResult {
  /** Short dependency name (e.g. "LLM", "ADO", "SonarQube", "Git"). */
  name: string;
  /** "ok" — connected and working; "fail" — unavailable; "skip" — not configured. */
  status: ReadinessStatus;
  /** Whether this blocks the review. */
  critical: boolean;
  /** Human-readable detail. */
  message: string;
}

// ─── Individual checks ───────────────────────────────────────────────────────

async function checkGit(logger: ReturnType<typeof getLogger>): Promise<ReadinessResult> {
  try {
    const { stdout } = await execFileAsync("git", ["--version"], {
      timeout: 5_000,
    });
    const version = stdout.trim();
    logger.info(`Git: ${version}`);
    return { name: "Git", status: "ok", critical: true, message: version };
  } catch (err) {
    const detail = (err as Error).message;
    logger.warn(`Git not found: ${detail}`);
    return {
      name: "Git",
      status: "fail",
      critical: true,
      message:
        "Git is required for sensitive-data masking (temporary repository setup). " +
        "Install Git and ensure it is on the PATH.",
    };
  }
}

async function checkAdo(
  provider: ConfigProvider,
  rootConfig: RootAgentConfig,
  logger: ReturnType<typeof getLogger>,
): Promise<ReadinessResult> {
  const adoConfig = rootConfig.ado;
  if (!adoConfig?.organization || !adoConfig?.project || !adoConfig?.token) {
    return {
      name: "ADO",
      status: "fail",
      critical: true,
      message: "Not fully configured — check config.ado.organization, .project, and .token.",
    };
  }

  try {
    const client = provider.getAdoClient();
    // getRepos() is a lightweight call that proves connectivity + permissions
    await client.getRepos();
    logger.info("ADO: connected");
    return {
      name: "ADO",
      status: "ok",
      critical: true,
      message: `Connected to ${adoConfig.organization}/${adoConfig.project}`,
    };
  } catch {
    return {
      name: "ADO",
      status: "fail",
      critical: true,
      message:
        "Connected but unable to list repos. " +
        "Check that your PAT has 'Code (Read)' scope and the org/project names are correct.",
    };
  }
}

async function checkLlm(
  rootConfig: RootAgentConfig,
  logger: ReturnType<typeof getLogger>,
): Promise<ReadinessResult> {
  const llmConfig = rootConfig.openCodeReview?.llm;
  if (!llmConfig?.url || !llmConfig?.token || !llmConfig?.model) {
    return {
      name: "LLM",
      status: "fail",
      critical: true,
      message:
        "Incomplete LLM configuration. Ensure config.openCodeReview.llm.url, .token, and .model are set.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_HEALTH_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(llmConfig.url, {
      signal: controller.signal,
      method: "GET",
      headers: {
        Authorization: `Bearer ${llmConfig.token}`,
        "x-api-key": llmConfig.token,
      },
    });

    if (response.ok) {
      logger.info(`LLM: reachable (${llmConfig.url})`);
      return {
        name: "LLM",
        status: "ok",
        critical: true,
        message: `Reachable at ${llmConfig.url} (model: ${llmConfig.model})`,
      };
    }

    logger.warn(`LLM endpoint returned: ${response.status} ${response.statusText}`);
    return {
      name: "LLM",
      status: "fail",
      critical: true,
      message: `Endpoint returned ${response.status} ${response.statusText} at ${llmConfig.url}`,
    };
  } catch (err) {
    logger.warn(`LLM endpoint not reachable: ${(err as Error).message}`);
    return {
      name: "LLM",
      status: "fail",
      critical: true,
      message:
        `Cannot connect to ${llmConfig.url}: ${(err as Error).message}. ` +
        "Check the URL, network connectivity, and firewall rules.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkSonarQube(
  provider: ConfigProvider,
  rootConfig: RootAgentConfig,
  logger: ReturnType<typeof getLogger>,
): Promise<ReadinessResult> {
  const sonarConfig = rootConfig.sonarQube;
  if (!sonarConfig?.url) {
    return {
      name: "SonarQube",
      status: "skip",
      critical: false,
      message: "Not configured — CVE scanning and quality measures will be skipped.",
    };
  }

  const client = provider.getSonarQubeClient();
  if (!client) {
    return {
      name: "SonarQube",
      status: "fail",
      critical: false,
      message:
        `Configured at ${sonarConfig.url} but not connected. ` +
        "Check the URL, token, and network connectivity.",
    };
  }

  logger.info("SonarQube: connected");
  return {
    name: "SonarQube",
    status: "ok",
    critical: false,
    message: `Connected at ${sonarConfig.url}`,
  };
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

export interface ReadinessReport {
  results: ReadinessResult[];
  criticalFailures: ReadinessResult[];
  allOk: boolean;
}

/**
 * Check all dependencies required for the review agent to operate.
 * Critical failures mean the review cannot proceed; non-critical
 * failures are reported but do not block execution.
 */
export async function checkReadiness(
  provider: ConfigProvider,
  rootConfig: RootAgentConfig,
): Promise<ReadinessReport> {
  const logger = getLogger("readiness");

  const results = await Promise.all([
    checkGit(logger),
    checkAdo(provider, rootConfig, logger),
    checkLlm(rootConfig, logger),
    checkSonarQube(provider, rootConfig, logger),
  ]);

  const criticalFailures = results.filter((r) => r.critical && r.status === "fail");
  const allOk = criticalFailures.length === 0;

  return { results, criticalFailures, allOk };
}

/**
 * Pretty-print the readiness report to the console.
 * Uses process.stdout.write to bypass console capture that respects log levels,
 * since this is user-facing output, not diagnostic logging.
 */
export function printReadinessReport(report: ReadinessReport): void {
  const ICONS: Record<ReadinessStatus, string> = {
    ok: "  ✓",
    fail: "  ✗",
    skip: "  –",
  };

  writeLine("\n── Readiness Check ──────────────────────────────");

  for (const r of report.results) {
    const icon = ICONS[r.status];
    const badge = r.critical ? " [critical]" : "";
    writeLine(`${icon} ${r.name}${badge}`);
    writeLine(`     ${r.message}`);
  }

  if (report.criticalFailures.length > 0) {
    writeLine(
      `\n  ✗ ${report.criticalFailures.length} critical depende${report.criticalFailures.length === 1 ? "ncy is" : "ncies are"} unavailable. ` +
      `The review cannot proceed until resolved.`,
    );
  } else {
    writeLine("\n  ✓ All critical dependencies are ready.");
  }

  writeLine("");
}

function writeLine(text: string): void {
  process.stdout.write(text + "\n");
}
