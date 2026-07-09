import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
// biome-ignore lint/style/useImportType: <explanation>
import { CodeReviewOrchestrationService } from "./orchestration.service";

@Injectable()
export class PullRequestQueueService {
  private prAvailabilityQueue: number[] = [];
  private processingPRId: number | null = null;

  constructor(
    private readonly codeReviewOrchestrationService: CodeReviewOrchestrationService,
  ) {}

  @OnEvent("pr.available")
  handleAvailablePREvent(prId: number) {
    this.prAvailabilityQueue.push(prId);
  }

  async processNextPR() {
    if (this.prAvailabilityQueue.length === 0) {
      return;
    }

    const prId = this.prAvailabilityQueue.shift()!;
    if (this.processingPRId === prId) {
      return;
    }

    this.processingPRId = prId;
    try {
      await this.codeReviewOrchestrationService.processCodeReview(prId);
    } catch (error) {
      console.error(`Error processing PR #${prId}:`, error);
    } finally {
      this.processingPRId = null;
    }
  }

  getPendingPRs(): number[] {
    return this.prAvailabilityQueue;
  }

  getProcessingPR(): number | null {
    return this.processingPRId;
  }
}
