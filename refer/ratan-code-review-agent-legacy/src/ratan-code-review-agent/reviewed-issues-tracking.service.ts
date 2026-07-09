import { Injectable, Logger } from "@nestjs/common";
import { AzureDevOps, type CommentThread } from "ratan-ado-api";
// biome-ignore lint/style/useImportType: <explanation>
import { DrizzleService } from "src/drizzle/drizzle.service";
// biome-ignore lint/style/useImportType: <explanation>
import { OctAuthService } from "./auth.service";

enum CommentThreadStatus {
  /**
   * The thread status is unknown.
   */
  Unknown = 0,
  /**
   * The thread status is active.
   */
  Active = 1,
  /**
   * The thread status is resolved as fixed.
   */
  Fixed = 2,
  /**
   * The thread status is resolved as won't fix.
   */
  WontFix = 3,
  /**
   * The thread status is closed.
   */
  Closed = 4,
  /**
   * The thread status is resolved as by design.
   */
  ByDesign = 5,
  /**
   * The thread status is pending.
   */
  Pending = 6,
}

@Injectable()
export class ReviewedIssuesTrackingService {
  constructor(
    private readonly octAuthService: OctAuthService,
    private readonly drizzleService: DrizzleService,
  ) {
    // Initialization logic here
  }
  private readonly logger = new Logger(ReviewedIssuesTrackingService.name, {
    timestamp: true,
  });

  async syncUpIssuesTrackingStatus({
    from,
    prIds,
  }: {
    from?: string;
    prIds?: number[];
  }) {
    this.logger.log("Starting sync up of issues tracking status...");

    this.logger.log(
      `Sync parameters - from: ${from}, prIds: ${prIds?.join(", ")}`,
    );

    const prs = await this.drizzleService.searchPullRequestReviewMemory({
      prIdList: prIds ?? [],
      updatedAt: from,
      pageNo: 0,
      pageSize: prIds?.length * 5 || 1000,
    });
    this.logger.log(`Found ${prs.total} PR reviews to process.`);

    if (prs.total === 0) {
      this.logger.log("No PR reviews found. Exiting sync process.");
      return;
    }

    const reviewDataMap = new Map(prs.data.map((r) => [r.id, r]));

    const issues = await this.drizzleService.listCodeReviewIssues({
      prReviewIdList: prs.data.map((p) => p.id),
      pageNo: 0,
      pageSize: 5000,
    });
    if (issues.total === 0) {
      this.logger.log("No issues found to sync.");
      return;
    }
    this.logger.log(`Found ${issues.total} issues to sync.`);
    const issueDatas = issues.data.filter(
      (issue) => issue.commentThreadId && issue.prReviewId,
    );
    this.logger.log(
      `Found ${issueDatas.length} issues with commentThreadId and prReviewId to sync.`,
    );

    if (issueDatas.length === 0) {
      this.logger.log("No issues with commentThreadId and prReviewId to sync.");
      return;
    }

    const existingIssueTrackingItems =
      await this.drizzleService.searchReviewedIssueTrackingByIds(
        issueDatas.map((i) => i.id),
      );
    this.logger.log(
      `Found ${existingIssueTrackingItems.length} existing issue tracking items.`,
    );

    const filteredIssueDatas = issueDatas.filter(
      (issue) =>
        !existingIssueTrackingItems.find(
          (existing) => existing.issueId === issue.id,
        ),
    );

    if (filteredIssueDatas.length === 0) {
      this.logger.log("No new issues to track.");
      return;
    }

    this.logger.log(`Tracking ${filteredIssueDatas.length} new issues.`);

    const commentThreads = filteredIssueDatas
      .map((issue) => ({
        repo: reviewDataMap.get(issue.prReviewId)?.repo,
        prId: reviewDataMap.get(issue.prReviewId)?.prId,
        commentId: issue.commentThreadId!,
        prReviewId: issue.prReviewId!,
      }))
      .filter((ct) => ct.repo && ct.prId && ct.commentId);
    this.logger.log(
      `Fetching latest status for ${commentThreads.length} comment threads.`,
    );
    if (commentThreads.length === 0) {
      this.logger.log("No valid comment threads to fetch status.");
      return;
    }
    const statuses =
      await this.fetchLatestStatusForIssueComment(commentThreads);
    this.logger.log(`Fetched statuses for ${statuses.length} comment threads.`);

    const newIssueTrackingRecords = statuses
      .map((status) => {
        const relatedIssue = issueDatas.find(
          (issue) => issue.commentThreadId === status.commentId,
        );
        return {
          issueId: relatedIssue?.id!,
          repo: status.repo,
          prId: status.prId,
          commentThreadId: status.commentId,
          status: CommentThreadStatus[status.status],
          comment: status.comments
            .slice(1)
            .map((c) => `${c.author}: ${c.content}`)
            .join("\n---\n"),
          falsePositive: status.comments
            .at(1)
            ?.content?.toLowerCase()
            .startsWith("no"),
          falsePositiveReason: status.comments.at(1)?.content || "",
          prReviewId: relatedIssue?.prReviewId!,
        };
      })
      .filter((r) => r.comment);

    if (newIssueTrackingRecords.length === 0) {
      this.logger.log("No new issue tracking records to create.");
      return;
    }

    this.logger.log(
      `Creating ${newIssueTrackingRecords.length} new issue tracking records.`,
    );

    const res = await this.drizzleService.batchCreateReviewedIssueTracking(
      newIssueTrackingRecords,
    );

    this.logger.log("Sync up of issues tracking status completed.");
  }

  async fetchLatestStatusForIssueComment(
    commentThreads: Array<{ repo: string; prId: number; commentId: number }>,
  ) {
    const { adoToken } = await this.octAuthService.getAvailableAuth();
    if (!adoToken) {
      this.logger.error("ADO token is not available.");
      throw new Error("ADO token is not available.");
    }
    const adoClient = new AzureDevOps();
    await adoClient.connect(adoToken);

    const results: Array<{
      repo: string;
      prId: number;
      commentId: number;
      status: CommentThread["status"];
      comments: Array<{
        id: number;
        content: string;
        author: string;
        updatedAt: string;
      }>;
    }> = [];

    for (const thread of commentThreads) {
      try {
        this.logger.log(
          `Fetching status for comment ID: ${thread.commentId} in PR: ${thread.prId} of repo: ${thread.repo}`,
        );
        const status = await adoClient.getCommentThreadById(
          thread.repo,
          thread.prId,
          thread.commentId,
        );
        if (status) {
          results.push({
            repo: thread.repo,
            prId: thread.prId,
            commentId: thread.commentId,
            status: status.status,
            comments: status.comments.map((c) => ({
              id: c.id,
              content: c.content?.trim() ?? "",
              author: c.author.displayName || "Unknown",
              updatedAt:
                c.lastUpdatedDate instanceof Date
                  ? c.lastUpdatedDate.toISOString()
                  : c.lastUpdatedDate || "",
            })),
          });
          this.logger.log(
            `Status for comment ID ${thread.commentId}: ${status.status}`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Error fetching status for comment ID ${thread.commentId}: ${error.message}`,
        );
      }
    }

    return results;
  }
}
