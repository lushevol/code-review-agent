import { getLogger } from "../utils/logger";
import type { ConfigProvider } from "agent-config-manager";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface QueueItem {
  prId: number;
  repoName: string;
  repoId?: string;
}

export type PRQueueProcessor = (item: QueueItem) => Promise<void>;

// ─── PR Queue Service ────────────────────────────────────────────────────────

export class PRQueueService {
  private queue: QueueItem[] = [];
  private processing = false;
  private currentPrId: number | null = null;
  private processor: PRQueueProcessor | null = null;
  private logger = getLogger("pr-queue");

  /**
   * Register the processor function that will be called for each dequeued PR.
   */
  setProcessor(processor: PRQueueProcessor) {
    this.processor = processor;
  }

  /**
   * Add a PR to the queue. Ignores duplicates already in queue or processing.
   */
  enqueue(item: QueueItem) {
    const alreadyQueued = this.queue.some(
      (q) => q.prId === item.prId && q.repoName === item.repoName,
    );
    if (alreadyQueued) {
      this.logger.debug(`PR #${item.prId} already queued, skipping`);
      return;
    }
    if (this.currentPrId === item.prId) {
      this.logger.debug(`PR #${item.prId} is currently processing, skipping`);
      return;
    }
    this.queue.push(item);
    this.logger.info(
      `PR #${item.prId} added to queue (${this.queue.length} pending)`,
    );
    this.processNext();
  }

  /**
   * Get the number of pending items.
   */
  get pendingCount(): number {
    return this.queue.length;
  }

  /**
   * Get the PR ID currently being processed, if any.
   */
  get currentProcessing(): number | null {
    return this.currentPrId;
  }

  /**
   * Get all pending queue items.
   */
  getPending(): QueueItem[] {
    return [...this.queue];
  }

  /**
   * Clear pending items. The item currently being processed is left alone.
   */
  clearPending(): number {
    const count = this.queue.length;
    this.queue = [];
    return count;
  }

  /**
   * Check if a PR with build pipeline exists before allowing it through the queue.
   * This queries ADO for build/CI status of the PR's latest commit.
   */
  async hasBuildPipeline(
    provider: ConfigProvider,
    prId: number,
    repoName: string,
  ): Promise<boolean> {
    try {
      const adoClient = provider.getAdoClient();
      const statuses = await adoClient.getPullRequestStatuses(
        repoName,
        prId,
      );

      // A build pipeline is detected by checking if any GitBuild status exists
      const hasBuild = (statuses ?? []).some(
        (s: { context?: { genre?: string } }) =>
          s.context?.genre === "GitBuild" ||
          s.context?.genre === "Build" ||
          s.context?.genre === "CI",
      );

      if (!hasBuild) {
        this.logger.info(
          `PR #${prId} has no build pipeline — will not process`,
        );
      }
      return hasBuild;
    } catch (err) {
      this.logger.warn(
        `Failed to check build pipeline for PR #${prId}: ${(err as Error).message}`,
      );
      // If we can't check, allow processing to avoid false negatives
      return true;
    }
  }

  /**
   * Process the next item in the queue.
   */
  private async processNext() {
    if (this.processing || this.queue.length === 0) return;
    if (!this.processor) {
      this.logger.warn("No processor registered for PR queue");
      return;
    }

    this.processing = true;
    const item = this.queue.shift()!;
    this.currentPrId = item.prId;

    try {
      this.logger.info(
        `Processing PR #${item.prId} (${item.repoName}) — ${this.queue.length} remaining`,
      );
      await this.processor(item);
      this.logger.info(
        `Completed PR #${item.prId} (${item.repoName})`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to process PR #${item.prId}: ${(err as Error).message}`,
      );
    } finally {
      this.currentPrId = null;
      this.processing = false;
      // Process next item if any
      setImmediate(() => this.processNext());
    }
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _instance: PRQueueService | null = null;

export function getPRQueue(): PRQueueService {
  if (!_instance) {
    _instance = new PRQueueService();
  }
  return _instance;
}
