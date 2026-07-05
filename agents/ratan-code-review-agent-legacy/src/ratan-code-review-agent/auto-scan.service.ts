import { Injectable, Logger } from "@nestjs/common";
// biome-ignore lint/style/useImportType: <explanation>
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  AzureDevOps,
  hasAlreadyCommented,
  isValidPullRequest,
} from "ratan-ado-api";
// biome-ignore lint/style/useImportType: <explanation>
import { OctAuthService } from "./auth.service";

@Injectable()
export class AutoScanService {
  private pendingPRs: { repo: string; pr: number }[] = [];
  constructor(
    private readonly octAuthService: OctAuthService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private readonly logger = new Logger(AutoScanService.name, {
    timestamp: true,
  });

  async performAutoScan() {
    const { adoToken } = await this.octAuthService.getAvailableAuth();
    const adoClient = new AzureDevOps();
    await adoClient.connect(adoToken);

    const myRepos = await adoClient.getRepos();

    const ratanRepos = myRepos.filter(
      (repo) =>
        repo.name &&
        (repo.name.startsWith("51358-ratan") ||
          repo.name.startsWith("51358-mfe") ||
          repo.name.startsWith("51358-single-ui-bff")),
    );

    this.pendingPRs.splice(0);

    for (const repo of ratanRepos) {
      if (repo.name) {
        this.logger.log(`Processing repository: ${repo.name}`);
        const prs = await adoClient.getPullRequestListByRepoName(
          repo.name,
          1,
          new Date(Date.now() - 3 * 7 * 24 * 60 * 60 * 1000).toISOString(), // 3 weeks
        );
        for (const pr of prs) {
          this.logger.log(`Checking PR: ${pr.pullRequestId}`);
          if (!pr.pullRequestId) continue;
          const isValid = isValidPullRequest(pr);
          if (!isValid) continue;
          const prDetails = await adoClient.getPullRequestById(
            pr.pullRequestId,
            false,
            true,
          );
          const isAlreadyCommented = hasAlreadyCommented(
            prDetails.commentThreads ?? [],
          );
          if (isAlreadyCommented) continue;

          this.pendingPRs.push({
            repo: repo.name,
            pr: pr.pullRequestId,
          });

          this.eventEmitter.emit("pr.available", pr.pullRequestId);
          this.logger.log(
            `Added PR #${pr.pullRequestId} from ${repo.name} to pending list.`,
          );
        }
      }
    }

    return this.pendingPRs;
  }
}
