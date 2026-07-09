import { Module } from "@nestjs/common";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { ScheduleModule } from "@nestjs/schedule";
import { DrizzleModule } from "../drizzle/drizzle.module";
import { CodeReviewAgentMonitorController } from "./agent-monitor.controller";
import { OctAuthService } from "./auth.service";
import { AutoScanService } from "./auto-scan.service";
import { IssueClassificationService } from "./issues-classify.service";
import { CodeReviewOrchestrationService } from "./orchestration.service";
import { ReviewedIssuesTrackingService } from "./reviewed-issues-tracking.service";
import { TaskSchedulerService } from "./task-scheduler.service";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    DrizzleModule,
  ],
  controllers: [CodeReviewAgentMonitorController],
  providers: [
    TaskSchedulerService,
    CodeReviewOrchestrationService,
    AutoScanService,
    OctAuthService,
    ReviewedIssuesTrackingService,
    IssueClassificationService,
  ],
})
export class RatanCodeReviewAgentModule {}
