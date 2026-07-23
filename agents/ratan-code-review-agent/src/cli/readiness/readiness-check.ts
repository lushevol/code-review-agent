import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { ConfigProvider, RootAgentConfig } from "agent-config-manager";
import { getLogger } from "ratan-logger";

const execFileAsync = promisify(execFile);

const LLM_TEST_TIMEOUT_MS = 30_000;

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

// ─── OCR Binary resolution ──────────────────────────────────────────────────

function resolveOcrBinary(): string | null {
  if (process.env.OCR_BINARY_PATH) return process.env.OCR_BINARY_PATH;
  try {
    const _require = createRequire(import.meta.url);
    const platformModule = _require(
      _require.resolve("@alibaba-group/open-code-review/scripts/platform.js"),
    ) as { resolveNativeBinary(): { path: string } | null };
    const resolved = platformModule.resolveNativeBinary();
    return resolved?.path ?? null;
  } catch {
    return null;
  }
}

// ─── LLM test via OCR binary ────────────────────────────────────────────────

interface OcrTestResult {
  success: boolean;
  error?: string;
}

async function runOcrLlmTest(
  llm: { url: string; token: string; model: string; protocol?: string },
  logger: ReturnType<typeof getLogger>,
): Promise<OcrTestResult> {
  const binaryPath = resolveOcrBinary();
  if (!binaryPath) {
    logger.warn("OCR binary not found — cannot run LLM test");
    return { success: false, error: "OCR binary not available" };
  }

  const tmpDir = fs.mkdtempSync("ocr-llm-test-");
  try {
    const configDir = path.join(tmpDir, ".opencodereview");
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    const llmConfig: Record<string, string> = {
      url: llm.url,
      auth_token: llm.token,
      model: llm.model,
    };
    if (llm.protocol) {
      llmConfig.protocol = llm.protocol;
    }
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({ llm: llmConfig }),
      { mode: 0o600 },
    );

    const { stdout, stderr } = await execFileAsync(binaryPath, ["llm", "test"], {
      timeout: LLM_TEST_TIMEOUT_MS,
      env: {
        ...process.env,
        HOME: tmpDir,
        OCR_NO_UPDATE: "1",
      },
    });

    const output = (stdout + stderr).trim();
    logger.info(`OCR llm test succeeded`, { output: output.slice(0, 200) });
    return { success: true };
  } catch (err) {
    const message = (err as Error).message;
    logger.warn(`OCR llm test failed: ${message}`);
    return { success: false, error: message };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
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

  const result = await runOcrLlmTest(llmConfig, logger);

  if (result.success) {
    logger.info(`LLM: connected via OCR test (${llmConfig.url})`);
    return {
      name: "LLM",
      status: "ok",
      critical: true,
      message: `Connected via OCR test (model: ${llmConfig.model})`,
    };
  }

  return {
    name: "LLM",
    status: "fail",
    critical: true,
    message:
      `OCR LLM test failed: ${result.error}. ` +
      "Check config.openCodeReview.llm.url, .token, and .model values. " +
      "The URL must point to an OpenAI-compatible chat completions endpoint. " +
      "Ensure the OCR binary and LLM endpoint are reachable.",
  };
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
