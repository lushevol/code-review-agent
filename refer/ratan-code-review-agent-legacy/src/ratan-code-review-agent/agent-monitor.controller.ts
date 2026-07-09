import { Body, Controller, Post } from "@nestjs/common";
// biome-ignore lint/style/useImportType: <explanation>
import { CodeReviewOrchestrationService } from "./orchestration.service";

@Controller("code-review-agent")
export class CodeReviewAgentMonitorController {
  constructor(
    private readonly codeReviewOrchestrationService: CodeReviewOrchestrationService,
  ) {}

  @Post("add-pending-pr")
    addPendingPR(
        @Body() body: { prId: number },
    ) {
        this.codeReviewOrchestrationService.processCodeReview(body.prId);
        return { status: "ok" };
    }
}
