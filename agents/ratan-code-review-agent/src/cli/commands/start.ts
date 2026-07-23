import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { FindingStore } from "finding-store";
import { loadConfig } from "../config/loader";
import { getLogger, cleanOldLogs, configureLogging, installConsoleCapture } from "../utils/logger";
import { getPRQueue } from "../services/pr-queue";
import { getAutoScanService } from "../services/auto-scan";
import { startReviewPrWithProvider } from "../../bootstrap";
import { FeedbackService } from "../../review/workflows/services/feedback-service";
import { checkReadiness, printReadinessReport } from "../readiness/readiness-check";

// ─── Constants ───────────────────────────────────────────────────────────────

const RATAN_DIR = ".ratan";

/**
 * Find the templates/ directory. Works in both tsx (dev, file at
 * src/cli/commands/) and compiled dist (flattened to dist/cli.js by rslib).
 */
function resolveTemplatesDir(): string {
  const startDirname = path.dirname(fileURLToPath(import.meta.url));
  // Try compiled first (dist/ → ../templates), then source (src/cli/commands/ → ../../../templates)
  for (const rel of ["../templates", "../../../templates"]) {
    const dir = path.resolve(startDirname, rel);
    if (fs.existsSync(path.join(dir, "config.json.template"))) return dir;
  }
  throw new Error(
    "Could not find templates/ directory. Ensure ratan-code-review is properly installed.\n" +
    "If running locally, ensure you're at the package root or run `pnpm build` first.",
  );
}
const TEMPLATES_DIR = resolveTemplatesDir();

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StartOptions {
  config?: string;
  watch?: boolean;
  prId?: number;
  repoPatterns?: string[];
}

// ─── Ratan Folder Setup ─────────────────────────────────────────────────────

function writeDefaultConfig(ratanDir: string) {
  const configPath = path.join(ratanDir, "config.json");
  if (!fs.existsSync(configPath)) {
    const configTemplate = fs.readFileSync(
      path.join(TEMPLATES_DIR, "config.json.template"),
      "utf-8",
    );
    fs.writeFileSync(configPath, configTemplate, "utf-8");
    console.log(`[start] Created default config at: ${configPath}`);
  }
}

function writeDefaultRules(ratanDir: string) {
  const rulePath = path.join(ratanDir, "opencodereview", "rule.json");
  if (!fs.existsSync(rulePath)) {
    const content = fs.readFileSync(
      path.join(TEMPLATES_DIR, "opencodereview", "rule.json.template"),
      "utf-8",
    );
    fs.writeFileSync(rulePath, content, "utf-8");
  }
}

export function ensureRatanFolder(ratanDirPath: string) {
  const ratanDir = path.resolve(ratanDirPath);

  if (!fs.existsSync(ratanDir)) {
    console.log(`[start] Creating .ratan folder at: ${ratanDir}`);
    fs.mkdirSync(path.join(ratanDir, "opencodereview"), { recursive: true });
    fs.mkdirSync(path.join(ratanDir, "logs"), { recursive: true });
    fs.mkdirSync(path.join(ratanDir, "data"), { recursive: true });
    writeDefaultConfig(ratanDir);
    writeDefaultRules(ratanDir);
    console.log(`[start] .ratan folder initialized at: ${ratanDir}`);
    return ratanDir;
  }

  // Existing .ratan/ — ensure config files exist (handles upgrades from old layout)
  fs.mkdirSync(path.join(ratanDir, "opencodereview"), { recursive: true });
  fs.mkdirSync(path.join(ratanDir, "logs"), { recursive: true });
  fs.mkdirSync(path.join(ratanDir, "data"), { recursive: true });
  writeDefaultConfig(ratanDir);
  writeDefaultRules(ratanDir);

  if (fs.existsSync(path.join(ratanDir, "prompts"))) {
    throw new Error(
      "Legacy prompts are no longer supported. Configure config.openCodeReview and use opencodereview/rule.json.",
    );
  }

  return ratanDir;
}

// ─── Timer registry for graceful shutdown ──────────────────────────────────

const registeredTimers: Array<NodeJS.Timeout> = [];

function clearAllTimers() {
  for (const timer of registeredTimers) {
    clearInterval(timer);
    clearTimeout(timer);
  }
  registeredTimers.length = 0;
}

function registerTimer(timer: NodeJS.Timeout): NodeJS.Timeout {
  registeredTimers.push(timer);
  return timer;
}

// ─── Feedback Daemon ────────────────────────────────────────────────────────

/**
 * Background process that syncs ADO comment thread statuses back
 * into the FindingStore. Runs on an interval alongside the scan loop.
 */
async function startFeedbackDaemon(
  provider: import("agent-config-manager").ConfigProvider,
  ratanDir: string,
) {
  const logger = getLogger("feedback-daemon");
  const rootConfig = await provider.getRootConfig();
  if (rootConfig.feedbackDaemon?.enabled === false) return;
  const FEEDBACK_INTERVAL_MS = rootConfig.feedbackDaemon?.intervalMs ?? 15 * 60 * 1000;

  const findingStorePath = rootConfig.findingStorePath ?? path.join(ratanDir, "data/findings.db");
  let findingStore: FindingStore;

  try {
    findingStore = new FindingStore(findingStorePath);
    await findingStore.init();
  } catch (err) {
    logger.warn(
      `Cannot init FindingStore for feedback daemon: ${(err as Error).message}`,
    );
    return;
  }

  const feedbackService = new FeedbackService(findingStore);

  const runCycle = async () => {
    try {
      // Get all unique PRs from audit records
      const auditRecords = findingStore.queryAuditRecords({});
      const prRepos = new Map<number, Set<string>>();
      for (const record of auditRecords) {
        const repos = prRepos.get(record.prId) ?? new Set<string>();
        repos.add(record.repository);
        prRepos.set(record.prId, repos);
      }

      let totalResolved = 0;
      let totalDismissed = 0;
      let totalFp = 0;

      for (const [prId, repos] of prRepos) {
        for (const repoName of repos) {
          try {
            const result = await feedbackService.syncAdoCommentThreads(
              provider,
              prId,
              repoName,
            );
            totalResolved += result.resolvedByDev;
            totalDismissed += result.dismissedByDev;
            totalFp += result.flaggedFalsePositive;
          } catch {
            // Per-PR failure is non-fatal
          }
        }
      }

      logger.info(
        `Feedback cycle: ${totalResolved} resolved, ${totalDismissed} dismissed, ${totalFp} FP flagged (${prRepos.size} PRs)`,
      );
    } catch (err) {
      logger.error(`Feedback cycle failed: ${(err as Error).message}`);
    }
  };

  // Schedule the initial run and recurring cycle, registering timers for cleanup
  const initialTimeout = setTimeout(() => {
    runCycle();
    registerTimer(setInterval(runCycle, FEEDBACK_INTERVAL_MS));
    logger.info(
      `Feedback daemon running every ${FEEDBACK_INTERVAL_MS / 60000} minutes`,
    );
  }, 30_000);
  registerTimer(initialTimeout);
}

// ─── Config wizard ───────────────────────────────────────────────────────────

const PLACEHOLDER_PATTERNS: Array<{ path: string[]; label: string; envVar?: string }> = [
  { path: ["ado", "organization"], label: "Azure DevOps organization" },
  { path: ["ado", "project"], label: "Azure DevOps project" },
  { path: ["ado", "token"], label: "Azure DevOps PAT (personal access token)", envVar: "ADO_TOKEN" },
  { path: ["openCodeReview", "llm", "url"], label: "LLM endpoint URL", envVar: "OCR_LLM_URL" },
  { path: ["openCodeReview", "llm", "token"], label: "LLM API token", envVar: "OCR_LLM_TOKEN" },
  { path: ["openCodeReview", "llm", "model"], label: "LLM model name" },
  { path: ["sonarQube", "url"], label: "SonarQube server URL", envVar: "SONARQUBE_URL" },
  { path: ["sonarQube", "token"], label: "SonarQube API token", envVar: "SONARQUBE_TOKEN" },
];

function isPlaceholder(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (
    value === "your-organization" ||
    value === "your-project" ||
    value === "set-your-llm-token" ||
    value === "set-your-sonar-token" ||
    value.startsWith("http://your-llm-endpoint") ||
    value.startsWith("https://your-sonarqube") ||
    value.startsWith("your-")
  ) return true;
  // env:X references where the env var is not set — treat as unresolved placeholder
  const envMatch = value.match(/^env:(.+)$/);
  if (envMatch && !process.env[envMatch[1]]) return true;
  return false;
}

function getNested(obj: Record<string, unknown>, pathArr: string[]): unknown {
  let current: unknown = obj;
  for (const key of pathArr) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function setNested(obj: Record<string, unknown>, pathArr: string[], value: string): void {
  let current = obj;
  for (let i = 0; i < pathArr.length - 1; i++) {
    if (!current[pathArr[i]] || typeof current[pathArr[i]] !== "object") {
      current[pathArr[i]] = {};
    }
    current = current[pathArr[i]] as Record<string, unknown>;
  }
  current[pathArr[pathArr.length - 1]] = value;
}

async function promptValue(label: string, currentValue: string, envVar?: string): Promise<string | null> {
  const envHint = envVar ? ` (or set ${envVar} environment variable)` : "";
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`  ${label}${envHint} [${currentValue}]: `, (answer) => {
      rl.close();
      resolve(answer.trim() || null);
    });
  });
}

async function configureDefaults(ratanDir: string): Promise<void> {
  const configPath = path.join(ratanDir, "config.json");
  if (!fs.existsSync(configPath)) return;

  if (!process.stdin.isTTY) return; // Non-interactive — skip prompts

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return; // Can't parse — skip
  }

  // Check if any placeholders exist
  const hasDefaults = PLACEHOLDER_PATTERNS.some((p) => {
    const val = getNested(config, p.path);
    return typeof val === "string" && isPlaceholder(val);
  });
  if (!hasDefaults) return; // Already configured — skip

  console.log("\n── First-time setup ──────────────────────────────");
  console.log("  Some configuration values still have default placeholders.");
  console.log("  Press Enter to keep a value, or type a new one.\n");

  for (const field of PLACEHOLDER_PATTERNS) {
    const val = getNested(config, field.path);
    if (typeof val !== "string" || !isPlaceholder(val)) continue;

    // If env var is set, use it automatically
    if (field.envVar && process.env[field.envVar]) {
      setNested(config, field.path, `env:${field.envVar}`);
      console.log(`  ${field.label} ← env:${field.envVar} (from environment)`);
      continue;
    }

    const answer = await promptValue(field.label, val, field.envVar);
    if (answer) {
      setNested(config, field.path, answer);
    }
  }

  // Write updated config back
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  console.log("  Config updated.\n");
}

// ─── Startup Validation ───────────────────────────────────────────────────────

const PLACEHOLDER_SONAR_TOKEN = "set-your-sonar-token";

function isSonarPlaceholder(value: string): boolean {
  return (
    value === PLACEHOLDER_SONAR_TOKEN ||
    value.startsWith("https://your-sonarqube") ||
    value.startsWith("http://your-sonarqube") ||
    value.startsWith("your-")
  );
}

function validateConfigInputs(
  config: import("agent-config-manager").RootAgentConfig,
  logger: ReturnType<typeof getLogger>,
): void {
  const warnings: string[] = [];
  const infos: string[] = [];

  // ── SonarQube validation ──────────────────────────────────────────────
  const sonarQube = config.sonarQube;
  const cveEnabled = config.scannerSettings?.cve?.enabled !== false;

  if (sonarQube?.url && sonarQube?.token) {
    if (isSonarPlaceholder(sonarQube.url)) {
      warnings.push(
        "SonarQube URL is still a placeholder (" + sonarQube.url + "). " +
        "Update config.sonarQube.url for SonarQube measures and CVE scanning.",
      );
    } else if (isSonarPlaceholder(sonarQube.token)) {
      warnings.push(
        "SonarQube token is still a placeholder. " +
        "Update config.sonarQube.token or use 'env:VAR_NAME' to reference an environment variable.",
      );
    } else {
      infos.push("SonarQube: configured at " + sonarQube.url);
    }
  } else if (!sonarQube?.url && cveEnabled) {
    warnings.push(
      "CVE scanner is enabled (scannerSettings.cve.enabled) but no SonarQube URL is configured. " +
      "Set config.sonarQube.url and config.sonarQube.token, or disable CVE scanning: " +
      'scannerSettings.cve.enabled = false.',
    );
  } else if (sonarQube?.url && !sonarQube?.token) {
    warnings.push(
      "SonarQube URL is configured but no token is provided. " +
      "SonarQube measures and CVE scanning will be unavailable. " +
      "Set config.sonarQube.token or reference it via 'env:VAR_NAME'.",
    );
  } else {
    infos.push("SonarQube: not configured (CVE scanning will be skipped)");
  }

  // ── ADO validation ──────────────────────────────────────────────────────
  const ado = config.ado;
  if (ado?.organization && ado?.project && ado?.token) {
    infos.push("Azure DevOps: configured (" + ado.organization + "/" + ado.project + ")");
  } else if (!ado?.token) {
    warnings.push(
      "ADO token is missing. " +
      "Set config.ado.token or supply the token via 'env:VAR_NAME' (e.g. 'env:ADO_TOKEN'). " +
      "ADO connection and PR review will be unavailable.",
    );
  } else {
    warnings.push(
      "ADO organization or project is missing. " +
      "Ensure config.ado.organization and config.ado.project are both set.",
    );
  }

  // ── Compliance scanner ────────────────────────────────────────────────
  const complianceEnabled = config.scannerSettings?.compliance?.enabled === true;
  infos.push(
    "Compliance scanner: " + (complianceEnabled ? "enabled" : "disabled"),
  );

  // ── OpenCodeReview ────────────────────────────────────────────────────
  const ocr = config.openCodeReview;
  if (ocr?.llm?.url && ocr?.llm?.token && ocr?.llm?.model) {
    const protocolInfo = ocr.llm.protocol ? ` (protocol: ${ocr.llm.protocol})` : "";
    infos.push("OpenCodeReview: configured (" + ocr.llm.model + " at " + ocr.llm.url + protocolInfo + ")");
  } else {
    warnings.push(
      "OpenCodeReview LLM config is incomplete. " +
      "Ensure config.openCodeReview.llm.url, .token, and .model are all set.",
    );
  }

  // ── Print results ─────────────────────────────────────────────────────
  for (const info of infos) {
    logger.info(info);
  }
  if (warnings.length > 0) {
    for (const warning of warnings) {
      logger.warn(warning);
    }
  }
}

// ─── Start Command ───────────────────────────────────────────────────────────

export async function startCommand(options: StartOptions) {
  const logger = getLogger("start");

  // 1. Setup .ratan folder
  const ratanDir = options.config
    ? path.resolve(options.config)
    : path.resolve(process.cwd(), RATAN_DIR);
  ensureRatanFolder(ratanDir);

  // 1b. Interactive config prompts for first-time setup
  await configureDefaults(ratanDir);

  // 2. Load config and apply logging before any service is started.
  logger.info("Loading configuration...");
  const { provider } = await loadConfig(ratanDir);
  const rootConfig = await provider.getRootConfig();
  const logging = rootConfig.logging;
  configureLogging({
    ...logging,
    directory: path.resolve(ratanDir, logging?.directory ?? "logs"),
  });
  cleanOldLogs(logging?.retentionDays);
  installConsoleCapture();

  try {
    await provider.connect();
  } catch (err) {
    logger.warn(
      `Provider connection failed: ${(err as Error).message}. ` +
      "The readiness check will report the details below.",
    );
  }

  // 3b. Validate key config inputs and alert on missing/placeholder values
  logger.info("Validating configuration inputs...");
  validateConfigInputs(rootConfig, logger);

  // 3c. Readiness check — verify all dependencies are actually reachable
  logger.info("Checking dependencies...");
  const readiness = await checkReadiness(provider, rootConfig);
  printReadinessReport(readiness);

  if (!readiness.allOk) {
    logger.error(
      `${readiness.criticalFailures.length} critical depende${readiness.criticalFailures.length === 1 ? "ncy is" : "ncies are"} unavailable. ` +
      "Resolve the issues above before running the review.",
    );
    process.exit(1);
  }
  logger.info("All dependencies ready.");

  // 4. Explicit reviews run directly so completion and failures propagate to the caller.
  if (options.prId !== undefined) {
    logger.info(`Reviewing single PR #${options.prId}`);
    await startReviewPrWithProvider(provider, options.prId);
    return;
  }

  const autoScan = getAutoScanService();
  autoScan.setRepoPatterns(options.repoPatterns ?? []);

  // 5. Initialize automatic-scan queue with build pipeline check
  const queue = getPRQueue();
  queue.setProcessor(async (item) => {
    const hasBuild = await queue.hasBuildPipeline(
      provider,
      item.prId,
      item.repoName,
    );
    if (!hasBuild) {
      logger.info(`Skipping PR #${item.prId} — no build pipeline detected`);
      return;
    }
    await startReviewPrWithProvider(provider, item.prId);
  });

  // 6. Start the feedback daemon (ado comment sync, false-positive detection)
  // 7. Handle --watch mode: scan every 30 minutes, daemon keeps running
  if (options.watch) {
    startFeedbackDaemon(provider, ratanDir);
    const INTERVAL_MS = rootConfig.watch?.intervalMs ?? 30 * 60 * 1000;

    const runScan = async () => {
      const healthy = await autoScan.isLLMEndpointHealthy(
        rootConfig.openCodeReview.llm.url,
        rootConfig.openCodeReview.llm.token,
      );
      if (!healthy) {
        logger.warn("LLM endpoint not healthy — skipping scan cycle");
        return;
      }
      logger.info("Running auto-scan...");
      const enqueued = await autoScan.scan(provider);
      logger.info(`Auto-scan cycle complete: ${enqueued} PRs enqueued`);
    };

    await runScan();
    registerTimer(setInterval(runScan, INTERVAL_MS));

    logger.info(
      `Scan running every ${INTERVAL_MS / 60000} min, feedback daemon active. Ctrl+C to stop.`,
    );

    await new Promise<void>((resolve) => {
      const onSignal = () => {
        clearAllTimers();
        resolve();
      };
      process.on("SIGTERM", onSignal);
      process.on("SIGINT", onSignal);
    });

    logger.info("Shutting down...");
    return;
  }

  // 8. Default mode: scan once and exit
  const enqueued = await autoScan.scan(provider);
  logger.info(`Scan complete: ${enqueued} PR(s) enqueued`);

  // Wait for queue to drain
  await new Promise<void>((resolve) => {
    const check = () => {
      if (queue.pendingCount === 0 && queue.currentProcessing === null) {
        resolve();
      } else {
        setTimeout(check, 1000);
      }
    };
    check();
  });

  logger.info("All done");
}
