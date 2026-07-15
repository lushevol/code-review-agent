import { defineStep } from "../../runtime";
import z from "zod";
import { FindingStore } from "finding-store";
import { extractAgentConfig } from "../../../bootstrap/session";
import { type CommonRequestContext, PullRequestSchema } from "../../types";
import { NormalizedFindingSchema } from "../../types/finding";
import { CODE_REVIEW_AGENT_LATEST_REVIEW_ID } from "../../utils/const";

const CommentInputSchema = z.object({
  prDetails: PullRequestSchema,
  findings: z.array(NormalizedFindingSchema),
  correlationSummary: z.string(),
  changesSinceLastReview: z.string().optional(),
  reviewSummary: z.string(),
  reviewExecutionStatus: z.enum(["complete", "incomplete"]),
  reviewMetadata: z.record(z.string(), z.unknown()),
  measures: z.union([z.any(), z.null()]),
  mergeDecision: z.enum(["allowed", "blocked", "pending"]),
  createdWorkItems: z.number(),
});

const CodeReviewResultSchema = z.object({
  mainCommentId: z.number().describe("The ID of the main comment added"),
  codeCommentIds: z
    .array(z.number())
    .describe("The IDs of the code comments added"),
});

export const comment = defineStep({
  id: "comment-review-results",
  description: "Reviews code changes and provides feedback",
  inputSchema: CommentInputSchema,
  outputSchema: CodeReviewResultSchema,
  execute: async ({ inputData, requestContext }) => {
    if (!inputData) {
      throw new Error("Input data not found");
    }

    const { prDetails, findings } = inputData;

    const agentConfig = extractAgentConfig(
      requestContext as unknown as CommonRequestContext,
    );

    const adoClient = agentConfig.getAdoClient();
    const rootConfig = await agentConfig.getRootConfig();
    const findingStore = new FindingStore(
      rootConfig.findingStorePath ?? ".ratan/data/findings.db",
    );
    findingStore.init();

    const codeCommentIds: number[] = [];

    // Post inline comments from scanner pipeline findings
    const findingsToComment = findings.slice(0, 30);
    for (const finding of findingsToComment) {
      if (!finding.filePath || finding.lineStart === null) continue;
      let commentThread: { id?: number };
      try {
        const commentText = `**${finding.severity.toUpperCase()}** - ${finding.title}` +
          (finding.description ? `\n\n${finding.description}` : "") +
          (finding.remediation ? `\n\n**Suggestion:** ${finding.remediation}` : "");
        commentThread = await adoClient.addCommentThreadForPRCode({
          repoId: prDetails.repoId,
          pullRequestId: prDetails.pullRequestId,
          comment: `${commentText}\n\n<!-- survey: please provide feedback -->`,
          filePath: finding.filePath,
          filePosition: "right",
          fileStartLine: finding.lineStart,
          fileEndLine: finding.lineEnd ?? finding.lineStart,
          fileStartOffset: 1,
          fileEndOffset: 1,
        });
      } catch (error) {
        // Silently skip per-line comment failures
        continue;
      }

      if (commentThread.id === undefined) continue;
      codeCommentIds.push(commentThread.id);

      try {
        findingStore.linkCommentThread({
          repository: prDetails.repoName,
          prId: prDetails.pullRequestId,
          findingId: finding.id,
          threadId: commentThread.id,
        });
      } catch (error) {
        console.error(
          `[comment-review-results] Failed to link comment thread ${commentThread.id} to finding ${finding.id}: ${(error as Error).message}`,
        );
      }
    }
    findingStore.close();

    const incompleteNotice =
      inputData.reviewExecutionStatus === "incomplete"
        ? "⚠️ **OpenCodeReview did not complete. Merge status is Pending; manual review is required.**\n\n"
        : "";
    const mainCommentSummary = incompleteNotice +
      (inputData.changesSinceLastReview || "") +
      (inputData.correlationSummary || "No issues detected.");
    const mainCommentThread = await adoClient.addCommentForPR(
      prDetails.repoName,
      prDetails.pullRequestId,
      {
        approve: findings.length === 0,
        errors: [],
      },
      `${mainCommentSummary}\n\n${inputData.reviewSummary}`,
      [],
      inputData.measures,
    );

    await adoClient.setPullRequestProperties(
      prDetails.repoName,
      prDetails.pullRequestId,
      {
        [`/${CODE_REVIEW_AGENT_LATEST_REVIEW_ID}`]: String(
          prDetails.latestSourceCommitId,
        ),
      },
    );

    return {
      mainCommentId: mainCommentThread.id,
      codeCommentIds,
    };
  },
});
