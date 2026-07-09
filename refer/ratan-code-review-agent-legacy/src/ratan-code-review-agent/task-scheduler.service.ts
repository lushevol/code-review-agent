import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
// biome-ignore lint/style/useImportType: <explanation>
import { OctAuthService } from "./auth.service";
// biome-ignore lint/style/useImportType: <explanation>
import { AutoScanService } from "./auto-scan.service";
// biome-ignore lint/style/useImportType: <explanation>
import { CodeReviewOrchestrationService } from "./orchestration.service";
// biome-ignore lint/style/useImportType: <explanation>
import { ReviewedIssuesTrackingService } from "./reviewed-issues-tracking.service";

@Injectable()
export class TaskSchedulerService implements OnModuleInit {
  private COOL_DOWN_INTERVAL = 20 * 60 * 1000; // 20 minutes

  constructor(
    private readonly codeReviewOrchestrationService: CodeReviewOrchestrationService,
    private readonly autoScanService: AutoScanService,
    private readonly octAuthService: OctAuthService,
    private readonly reviewedIssuesTrackingService: ReviewedIssuesTrackingService,
  ) {}

  private readonly logger = new Logger(TaskSchedulerService.name, {
    timestamp: true,
  });

  async onModuleInit() {
    this.logger.log("Starting scheduled task loop on launch.");
    this.runScheduledTaskLoop();
    this.syncUpReviewedIssuesTracking();
  }

  private async syncUpReviewedIssuesTracking() {
    await this.reviewedIssuesTrackingService.syncUpIssuesTrackingStatus({
      from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  private async runScheduledTaskLoop() {
    while (true) {
      await this.handleScheduledTasks();
      this.logger.log(
        `Cooldown: waiting ${this.COOL_DOWN_INTERVAL / 1000 / 60} minutes before next run.`,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, this.COOL_DOWN_INTERVAL),
      );
    }
  }

  async handleScheduledTasks() {
    let enabled = false;
    try {
      const response = await fetch("http://localhost:1212/v1/models");
      if (response.ok) {
        const models = await response.json();
        if (Array.isArray(models.data) && models.data.length > 0) {
          enabled = true;
        }
      } else {
        this.logger.warn(
          `Failed to fetch workers status: ${response.statusText}`,
        );
      }
    } catch (err) {
      this.logger.warn(`Error fetching workers status: ${err}`);
    }
    if (!enabled) {
      this.logger.log("No available workers. Skipping scheduled tasks.");
      return;
    }

    const { adoToken } = await this.octAuthService.getAvailableAuth();
    if (!adoToken) {
      this.logger.warn(
        "No valid ADO token available. Skipping scheduled tasks.",
      );
      return;
    }
    const pendingPRs = await this.autoScanService.performAutoScan();
    if (pendingPRs.length === 0) {
      this.logger.log("No pending PRs found for processing.");
      return;
    }
    this.logger.log(`Found ${pendingPRs.length} pending PR(s) for processing.`);
    for (const pr of pendingPRs) {
      try {
        this.logger.log(`Processing PR ${pr.pr} in repository ${pr.repo}`);
        await this.codeReviewOrchestrationService.processCodeReview(pr.pr);
      } catch (error) {
        this.logger.error(`Error processing PR ${pr.pr}:`, error);
      }
    }
    this.logger.log("Completed scheduled task processing.");
  }
}
