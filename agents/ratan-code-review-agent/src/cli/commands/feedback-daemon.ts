import type { FindingStore } from "finding-store";
import type { AzureDevOps } from "ratan-ado-api";

export interface FeedbackDaemonOptions {
  findingStore: FindingStore;
  adoClient: AzureDevOps;
  intervalMs: number;
}

export class FeedbackDaemon {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private options: FeedbackDaemonOptions) {}

  async start(): Promise<void> {
    this.running = true;
    console.log(`Feedback daemon started (interval: ${this.options.intervalMs}ms)`);
    await this.collectCycle();
    this.timer = setInterval(() => this.collectCycle(), this.options.intervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async collectCycle(): Promise<void> {
    if (!this.running) return;

    try {
      // Get all open findings that have been commented on
      const findings = this.options.findingStore.getFindingsByEngine("ai-review");
      const findingsWithThreads = findings.filter(f => f.linkedTaskId !== null);

      for (const finding of findingsWithThreads.slice(0, 50)) {
        // In production, this would:
        // 1. Use commentThreadId to fetch ADO thread
        // 2. Check for human replies
        // 3. Classify feedback (true-positive, false-positive, etc.)
        // 4. Store feedback
        // 5. Aggregate FP rates
      }

      // Generate report
      console.log("Feedback daemon cycle complete:",
        `processed ${findings.length} findings`);
    } catch (err) {
      console.error("Feedback daemon cycle error:", err);
    }
  }

  async generateReport(): Promise<Record<string, unknown>> {
    // Aggregate feedback stats per engine
    return {
      timestamp: new Date().toISOString(),
      engines: {},
      highFpRules: [],
      suggestions: [],
    };
  }
}
