import { FindingStore } from "finding-store";
import type { ConfigProvider } from "agent-config-manager";
import { getLogger } from "../../../cli/utils/logger";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FeedbackEntry {
  findingId: string;
  feedbackType:
    | "true-positive"
    | "false-positive"
    | "lack-of-context"
    | "by-design"
    | "risk-accepted"
    | "already-addressed";
  userId: string;
  comment?: string;
  timestamp: string;
}

/**
 * Status of an ADO comment thread (mirror of Azure DevOps GitStatus).
 */
enum CommentThreadStatus {
  Unknown = 0,
  Active = 1,
  Fixed = 2,
  WontFix = 3,
  Closed = 4,
  ByDesign = 5,
  Pending = 6,
}

// ─── Feedback Service ────────────────────────────────────────────────────────

export class FeedbackService {
  private findingStore: FindingStore;
  private logger = getLogger("feedback");

  constructor(findingStore: FindingStore) {
    this.findingStore = findingStore;
  }

  /**
   * Record a feedback entry for a finding and update its resolution.
   */
  async recordFeedback(feedback: FeedbackEntry): Promise<void> {
    const finding = this.findingStore.getFindingById(feedback.findingId);
    if (!finding) {
      throw new Error(`Finding not found: ${feedback.findingId}`);
    }

    this.logger.info(
      `Recording feedback for ${feedback.findingId}: ${feedback.feedbackType} (by ${feedback.userId})`,
    );

    // Map feedback type to resolution
    const resolutionMap: Record<string, string> = {
      "false-positive": "resolved",
      "already-addressed": "resolved",
      "by-design": "resolved",
      "risk-accepted": "accepted-risk",
    };

    const resolution = resolutionMap[feedback.feedbackType];
    if (resolution) {
      this.findingStore.updateResolution(feedback.findingId, resolution, {
        overriddenBy: feedback.userId,
        justification: feedback.comment ?? feedback.feedbackType,
      });
    }
  }

  /**
   * Sync comment thread statuses from ADO back into the finding store.
   *
   * For each finding that has a linked comment thread in ADO, fetch its
   * current status and update the finding's resolution accordingly:
   *   - Fixed / Closed → resolved
   *   - WontFix / ByDesign → waived
   *   - Pending → open (no change)
   *
   * This method also flags findings as potential false positives when ADO
   * comment replies start with "no" or express disagreement.
   */
  async syncAdoCommentThreads(
    provider: ConfigProvider,
    prId: number,
    repoName: string,
  ): Promise<{
    syncedCount: number;
    resolvedByDev: number;
    dismissedByDev: number;
    flaggedFalsePositive: number;
  }> {
    const adoClient = provider.getAdoClient();
    let syncedCount = 0;
    let resolvedByDev = 0;
    let dismissedByDev = 0;
    let flaggedFalsePositive = 0;

    // Get all findings for this PR that have a linked comment thread
    const findings = this.findingStore.getFindingsByPr(prId, repoName);

    for (const finding of findings) {
      // Try to find matching thread — we can match by finding's linked properties
      // In practice, comment threads for this finding are tracked via the
      // FindingStore's override/audit mechanisms. We query ADO to get the
      // latest status of threads associated with the review.

      // Fetch all comment threads on this PR
      try {
        const threads = await adoClient.getPullRequestThreads(
          repoName,
          prId,
        );

        for (const thread of threads ?? []) {
          if (thread.status === undefined || thread.status === null) continue;

          const statusKey = CommentThreadStatus[thread.status] || "Unknown";

          // Check if this thread's comments indicate false positive
          const hasFalsePositiveIndication = (thread.comments ?? []).some(
            (c: { content?: string }) =>
              c.content?.toLowerCase().startsWith("no") ||
              c.content?.toLowerCase().includes("false positive") ||
              c.content?.toLowerCase().includes("not a bug"),
          );

          if (hasFalsePositiveIndication) {
            this.findingStore.updateResolution(finding.id, "resolved", {
              overriddenBy: "system",
              justification: `Auto-detected false positive from ADO comment: ${statusKey}`,
            });
            flaggedFalsePositive++;
          }

          // Map thread status to finding resolution
          if (
            statusKey === "Fixed" ||
            statusKey === "Closed"
          ) {
            // Developer has resolved/fixed the issue — mark as resolved
            this.findingStore.updateResolution(finding.id, "resolved", {
              overriddenBy: "system",
              justification: `Issue resolved by developer (ADO: ${statusKey})`,
            });
            resolvedByDev++;
            syncedCount++;
          } else if (
            statusKey === "WontFix" ||
            statusKey === "ByDesign"
          ) {
            // Developer has dismissed the issue
            this.findingStore.updateResolution(finding.id, "waived", {
              overriddenBy: "system",
              justification: `Issue dismissed by developer (ADO: ${statusKey})`,
            });
            dismissedByDev++;
            syncedCount++;
          }
        }
      } catch (err) {
        this.logger.debug(
          `Error syncing thread for finding ${finding.id}: ${(err as Error).message}`,
        );
        // Continue with next finding
      }
    }

    this.logger.info(
      `Sync complete: ${syncedCount} threads, ${resolvedByDev} resolved, ${dismissedByDev} dismissed, ${flaggedFalsePositive} FP flagged`,
    );

    return { syncedCount, resolvedByDev, dismissedByDev, flaggedFalsePositive };
  }

  /**
   * Calculate false-positive rates per engine and flag high-FP rules.
   */
  async getFeedbackStats(): Promise<{
    perEngine: Record<
      string,
      { total: number; falsePositive: number; fpRate: number }
    >;
    highFpRules: string[];
  }> {
    const HIGH_FP_THRESHOLD = 0.3;
    const perEngine: Record<
      string,
      { total: number; falsePositive: number; fpRate: number }
    > = {};
    const highFpRules: string[] = [];
    const engines = ["ai-review", "sonarqube-cve", "compliance"];

    for (const engine of engines) {
      let findings;
      try {
        findings = this.findingStore.getFindingsByEngine(engine);
      } catch {
        findings = [];
      }

      const total = findings.length;
      const falsePositive = findings.filter(
        (f: { resolution?: string }) =>
          f.resolution === "resolved" || f.resolution === "waived",
      ).length;
      const fpRate = total > 0 ? falsePositive / total : 0;

      perEngine[engine] = { total, falsePositive, fpRate };

      if (fpRate > HIGH_FP_THRESHOLD) {
        highFpRules.push(engine);
      }
    }

    return { perEngine, highFpRules };
  }

  /**
   * Export feedback data in JSON format.
   */
  async exportFeedback(format: "json" | "csv"): Promise<string> {
    if (format === "csv") {
      return "findingId,feedbackType,userId,comment,timestamp\n";
    }

    const stats = await this.getFeedbackStats();
    return JSON.stringify({ stats, note: "Feedback tracked via ADO comment sync" }, null, 2);
  }
}
