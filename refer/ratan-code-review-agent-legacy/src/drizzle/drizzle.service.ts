import { Inject, Injectable, Logger } from "@nestjs/common";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
  batchCreateCodeReviewIssues,
  batchCreateReviewedIssueTracking,
  batchUpdateCodeReviewIssue,
  getAllUnclassifiedIssues,
  getLatestPullRequestReviewByPRId,
  getPullRequestReviewByIds,
  listCodeReviewIssues,
  type schema,
  searchPullRequestReview,
  searchReviewedIssueTracking,
  searchReviewedIssueTrackingByIds,
  upsertPullRequestReview,
  workbenchAuthSearchAvailableAdoToken,
  workbenchAuthSearchAvailableSonarToken,
} from "ratan-orm";

@Injectable()
export class DrizzleService {
  constructor(
    @Inject("DRIZZLE_ORM")
    private readonly db: NodePgDatabase<typeof schema> & { $client: Pool }
  ) {}
  private readonly logger = new Logger(DrizzleService.name, {
    timestamp: true,
  });
  getDB() {
    return this.db;
  }

  async getLatestPullRequestReviewByPRId(prId: number) {
    try {
      const [review] = await getLatestPullRequestReviewByPRId(
        prId,
        this.getDB(),
      );
      this.logger.log("Fetched pull request review memory:", review);
      return review;
    } catch (error) {
      this.logger.error("Failed to fetch pull request review memory:", error);
      return null;
    }
  }

  async batchCreateCodeReviewIssues(
    issues: Omit<schema.NewCodeReviewIssue, "id" | "createdAt" | "updatedAt">[],
  ) {
    try {
      const result = await batchCreateCodeReviewIssues(issues, this.getDB());
      this.logger.log("Batch created code review issues successfully", result);
      return result;
    } catch (error) {
      this.logger.error("Failed to batch create code review issues:", error);
      return null;
    }
  }

  async upsertPullRequestReview(
    data: Omit<
      schema.NewPullRequestReviewMemory,
      "id" | "createdAt" | "updatedAt"
    >,
  ) {
    try {
      const result = await upsertPullRequestReview(data, this.getDB());
      this.logger.log(
        "Upserted pull request review memory successfully",
        result,
      );
      return result;
    } catch (error) {
      this.logger.error("Failed to upsert pull request review memory:", error);
      return null;
    }
  }

  async searchPullRequestReviewMemory(params: {
    status?: string;
    repo?: string;
    prIdList?: number[];
    prId?: number;
    latestSourceCommit?: string;
    latestTargetCommit?: string;
    codeReviewPassed?: boolean;
    updatedAt?: string;
    pageNo: number;
    pageSize: number;
  }) {
    try {
      const result = await searchPullRequestReview(params, this.getDB());
      return result;
    } catch (error) {
      this.logger.error(
        "Failed to search pull request review memory:",
        JSON.stringify(error),
      );
      return {
        data: [],
        total: 0,
        pageNo: params.pageNo,
        pageSize: params.pageSize,
      };
    }
  }

  async listCodeReviewIssues(
    filters: Partial<schema.CodeReviewIssue> & {
      prReviewIdList?: number[];
      pageNo: number;
      pageSize: number;
    },
  ) {
    try {
      const result = await listCodeReviewIssues(filters, this.getDB());
      return result;
    } catch (error) {
      this.logger.error("Failed to list code review issues:", error);
      return {
        data: [],
        total: 0,
        pageNo: 0,
        pageSize: 0,
      };
    }
  }

  async getAllUnclassifiedIssues(params: { pageNo: number; pageSize: number }) {
    try {
      const result = await getAllUnclassifiedIssues(params, this.getDB());
      this.logger.log(
        `Retrieved ${result.length} unclassified issues from the database.`,
      );
      return result;
    } catch (error) {
      this.logger.error("Failed to retrieve unclassified issues:", error);
      return [];
    }
  }

  async batchUpdateCodeReviewIssue(issues: Partial<schema.CodeReviewIssue>[]) {
    try {
      const result = await batchUpdateCodeReviewIssue(issues, this.getDB());
      this.logger.log("Batch updated code review issues successfully", result);
      return result;
    } catch (error) {
      this.logger.error("Failed to batch update code review issues:", error);
      return null;
    }
  }

  async listIssuesTrackingItems(
    filters: Partial<schema.ReviewedIssueTracking> & {
      issueIdList: number[];
      pageNo: number;
      pageSize: number;
    },
  ) {
    try {
      const result = await searchReviewedIssueTracking(filters, this.getDB());
      return result;
    } catch (error) {
      this.logger.error("Failed to list issues tracking items:", error);
      return {
        data: [],
        total: 0,
        pageNo: 0,
        pageSize: 0,
      };
    }
  }

  async getPullRequestReviewByIds(ids: number[]) {
    try {
      const result = await getPullRequestReviewByIds(ids, this.getDB());
      return result;
    } catch (error) {
      this.logger.error("Failed to get pull request review by ids:", error);
      return [];
    }
  }

  async searchReviewedIssueTrackingByIds(issueIds: number[]) {
    try {
      const result = await searchReviewedIssueTrackingByIds(
        issueIds,
        this.getDB(),
      );
      return result;
    } catch (error) {
      this.logger.error(
        "Failed to search reviewed issue tracking by ids:",
        error,
      );
      return [];
    }
  }

  async batchCreateReviewedIssueTracking(
    datas: Omit<schema.NewReviewedIssueTracking, "createdAt" | "updatedAt">[],
  ) {
    try {
      const result = await batchCreateReviewedIssueTracking(
        datas,
        this.getDB(),
      );
      this.logger.log(
        "Batch created reviewed issue tracking successfully",
        result,
      );
      return result;
    } catch (error) {
      this.logger.error(
        "Failed to batch create reviewed issue tracking:",
        error,
      );
      return null;
    }
  }

  async workbenchAuthSearchAvailableAdoToken() {
    try {
      const result = await workbenchAuthSearchAvailableAdoToken(this.getDB());
      return result;
    } catch (error) {
      this.logger.error(
        "Failed to get workbench auth available ado token:",
        error,
      );
      return null;
    }
  }

  async workbenchAuthSearchAvailableSonarToken() {
    try {
      const result = await workbenchAuthSearchAvailableSonarToken(this.getDB());
      return result;
    } catch (error) {
      this.logger.error(
        "Failed to get workbench auth available ado token:",
        error,
      );
      return null;
    }
  }
}
