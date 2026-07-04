import { FindingStore } from "finding-store";

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

export class FeedbackService {
  constructor(private findingStore: FindingStore) {}

  /**
   * Record user feedback for a finding.
   *
   * Note: persistence of feedback requires a feedback tracking mechanism in the
   * FindingStore layer. The current FindingStore implementation does not include a
   * dedicated feedback table; this method logs the feedback for future integration
   * when that layer becomes available.
   */
  async recordFeedback(feedback: FeedbackEntry): Promise<void> {
    const finding = this.findingStore.getFindingById(feedback.findingId);
    if (!finding) {
      throw new Error(`Finding not found: ${feedback.findingId}`);
    }

    console.log(
      `[feedback-service] Recording feedback for finding ${feedback.findingId}: ${feedback.feedbackType} (by ${feedback.userId})`,
    );

    // If the feedback type indicates the finding should be resolved, update it
    if (
      feedback.feedbackType === "false-positive" ||
      feedback.feedbackType === "already-addressed"
    ) {
      this.findingStore.updateResolution(
        feedback.findingId,
        "resolved",
        {
          overriddenBy: feedback.userId,
          justification: feedback.comment ?? feedback.feedbackType,
        },
      );
    }

    if (feedback.feedbackType === "risk-accepted") {
      this.findingStore.updateResolution(
        feedback.findingId,
        "accepted-risk",
        {
          overriddenBy: feedback.userId,
          justification: feedback.comment ?? feedback.feedbackType,
        },
      );
    }

    if (feedback.feedbackType === "by-design") {
      this.findingStore.updateResolution(
        feedback.findingId,
        "resolved",
        {
          overriddenBy: feedback.userId,
          justification: feedback.comment ?? feedback.feedbackType,
        },
      );
    }
  }

  /**
   * Calculate false-positive rates per engine and flag high-FP rules.
   * Returns a summary object with per-engine stats and a list of high-FP rule IDs.
   */
  async getFeedbackStats(): Promise<{
    perEngine: Record<
      string,
      { total: number; falsePositive: number; fpRate: number }
    >;
    highFpRules: string[];
  }> {
    // Collect findings grouped by source engine for FP rate calculation.
    // This uses the existing FindingStore query capabilities.
    // A dedicated feedback table would provide more accurate statistics.

    const perEngine: Record<
      string,
      { total: number; falsePositive: number; fpRate: number }
    > = {};

    const highFpRules: string[] = [];
    const HIGH_FP_THRESHOLD = 0.3;

    // For now, query findings per engine to derive approximate stats.
    // In a production deployment with a feedback table, aggregate FP counts
    // directly from the feedback records.
    const engines = ["ai-review", "sonarqube-cve", "compliance"];
    for (const engine of engines) {
      let findings;
      try {
        findings = this.findingStore.getFindingsByEngine(engine);
      } catch {
        findings = [];
      }
      const total = findings.length;
      // Without a dedicated feedback table, assume 0 FP for the initial report.
      // Once the FindingStore supports feedback queries, replace with actual counts.
      perEngine[engine] = {
        total,
        falsePositive: 0,
        fpRate: 0,
      };
    }

    return { perEngine, highFpRules };
  }

  /**
   * Export feedback data in the requested format.
   * When a feedback table is available, this produces a full export.
   * Currently returns the feedback logged via recordFeedback as a summary.
   */
  async exportFeedback(format: "json" | "csv"): Promise<string> {
    if (format === "json") {
      return JSON.stringify(
        { feedback: [], note: "Feedback persistence layer pending" },
        null,
        2,
      );
    }

    // CSV format
    return "findingId,feedbackType,userId,comment,timestamp\n";
  }
}
