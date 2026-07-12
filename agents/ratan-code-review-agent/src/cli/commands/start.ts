import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FindingStore } from "finding-store";
import { loadConfig } from "../config/loader";
import { getLogger, cleanOldLogs } from "../utils/logger";
import { getPRQueue } from "../services/pr-queue";
import { getAutoScanService } from "../services/auto-scan";
import { startReviewPrWithProvider } from "../../bootstrap";
import { FeedbackService } from "../../review/workflows/services/feedback-service";

// ─── Constants ───────────────────────────────────────────────────────────────

const RATAN_DIR = ".ratan";

// Template files live at <package-root>/templates/. Resolve path relative to
// this source file, which works in both tsx (dev) and compiled (dist) contexts
// since both maintain the same depth from the package root.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.resolve(__dirname, "../../../templates");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StartOptions {
  config?: string;
  watch?: boolean;
  prId?: number;
  repoPatterns?: string[];
}

// ─── Ratan Folder Setup ─────────────────────────────────────────────────────

export function ensureRatanFolder(ratanDirPath: string) {
  const ratanDir = path.resolve(ratanDirPath);

  if (!fs.existsSync(ratanDir)) {
    console.log(`[start] Creating .ratan folder at: ${ratanDir}`);
    fs.mkdirSync(path.join(ratanDir, "opencodereview"), { recursive: true });
    fs.mkdirSync(path.join(ratanDir, "logs"), { recursive: true });
    fs.mkdirSync(path.join(ratanDir, "data"), { recursive: true });

    // Write default config from template
    const configPath = path.join(ratanDir, "config.json");
    if (!fs.existsSync(configPath)) {
      const configTemplate = fs.readFileSync(
        path.join(TEMPLATES_DIR, "config.json.template"),
        "utf-8",
      );
      fs.writeFileSync(configPath, configTemplate, "utf-8");
      console.log(`[start] Created default config at: ${configPath}`);
    }

    const rulePath = path.join(ratanDir, "opencodereview", "rule.json");
    if (!fs.existsSync(rulePath)) {
      const content = fs.readFileSync(
        path.join(TEMPLATES_DIR, "opencodereview", "rule.json.template"),
        "utf-8",
      );
      fs.writeFileSync(rulePath, content, "utf-8");
    }

    console.log(`[start] .ratan folder initialized at: ${ratanDir}`);
  }

  if (fs.existsSync(path.join(ratanDir, "prompts"))) {
    throw new Error(
      "Legacy prompts are no longer supported. Configure config.openCodeReview and use opencodereview/rule.json.",
    );
  }

  return ratanDir;
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
  const FEEDBACK_INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes

  const findingStorePath = path.join(ratanDir, "data/findings.db");
  let findingStore: FindingStore;

  try {
    findingStore = new FindingStore(findingStorePath);
    findingStore.init();
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

  // Run first cycle after a delay (give the main scan time to start)
  setTimeout(() => {
    runCycle();
    setInterval(runCycle, FEEDBACK_INTERVAL_MS);
    logger.info(
      `Feedback daemon running every ${FEEDBACK_INTERVAL_MS / 60000} minutes`,
    );
  }, 30_000);
}

// ─── Start Command ───────────────────────────────────────────────────────────

export async function startCommand(options: StartOptions) {
  const logger = getLogger("start");

  // 1. Clean old logs (>30 days)
  cleanOldLogs(30);

  // 2. Setup .ratan folder
  const ratanDir = options.config
    ? path.resolve(options.config)
    : path.resolve(process.cwd(), RATAN_DIR);
  ensureRatanFolder(ratanDir);

  // 3. Load config
  logger.info("Loading configuration...");
  const { provider } = await loadConfig(ratanDir);
  await provider.connect();

  // 4. Initialize PR queue with build pipeline check
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

  // 5. Handle single PR mode
  if (options.prId !== undefined) {
    logger.info(`Reviewing single PR #${options.prId}`);
    queue.enqueue({ prId: options.prId, repoName: "" });
    return;
  }

  // 6. Start the feedback daemon (ado comment sync, false-positive detection)
  // 7. Handle --watch mode: scan every 30 minutes, daemon keeps running
  if (options.watch) {
    startFeedbackDaemon(provider, ratanDir);
    const INTERVAL_MS = 30 * 60 * 1000;

    const runScan = async () => {
      const autoScan = getAutoScanService();
      const healthy = await autoScan.isLLMEndpointHealthy();
      if (!healthy) {
        logger.warn("LLM endpoint not healthy — skipping scan cycle");
        return;
      }
      logger.info("Running auto-scan...");
      const enqueued = await autoScan.scan(provider);
      logger.info(`Auto-scan cycle complete: ${enqueued} PRs enqueued`);
    };

    await runScan();
    setInterval(runScan, INTERVAL_MS);

    logger.info(
      `Scan running every ${INTERVAL_MS / 60000} min, feedback daemon active. Ctrl+C to stop.`,
    );

    await new Promise<void>((resolve) => {
      process.on("SIGTERM", resolve);
      process.on("SIGINT", resolve);
    });

    logger.info("Shutting down...");
    return;
  }

  // 8. Default mode: scan once and exit
  const autoScan = getAutoScanService();
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
