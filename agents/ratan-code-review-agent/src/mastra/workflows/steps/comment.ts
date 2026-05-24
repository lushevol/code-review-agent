import { createStep } from "@mastra/core";
import z from "zod";
import { extractAgentConfig } from "../../../bootstrap/session";
import {
  CodeReviewIssueWithCategorySchema,
  type CommonRuntimeContext,
} from "../../types";
import { codeCommentHelper } from "../../utils/code-comment";
import { CODE_REVIEW_AGENT_LATEST_REVIEW_ID } from "../../utils/const";
import type { PRDetailsResult } from "./fetch-pr";

const CommentInputSchema = z.object({
  "pr-review-issues-workflow": z.object({
    issues: z.array(CodeReviewIssueWithCategorySchema),
  }),
  "code-summary": z.object({
    codeChangeSummary: z.string().describe("The summary of the code changes"),
  }),
  "sonarqube-measures": z.object({
    measures: z
      .union([z.any(), z.null()])
      .describe("The SonarQube measures for the pull request"),
  }),
});

const CodeReviewResultSchema = z.object({
  mainCommentId: z.number().describe("The ID of the main comment added"),
  codeCommentIds: z
    .array(z.number())
    .describe("The IDs of the code comments added"),
});

export const comment = createStep({
  id: "comment-review-results",
  description: "Reviews code changes and provides feedback",
  inputSchema: CommentInputSchema,
  outputSchema: CodeReviewResultSchema,
  execute: async ({ inputData, runtimeContext, getStepResult }) => {
    if (!inputData) {
      throw new Error("Input data not found");
    }

    const {
      "pr-review-issues-workflow": prReviewIssues,
      "code-summary": codeSummary,
      "sonarqube-measures": sonarqubeMeasures,
    } = inputData;

    const { prDetails } = getStepResult("fetch-pr-details") as PRDetailsResult;

    const agentConfig = extractAgentConfig(
      runtimeContext as unknown as CommonRuntimeContext,
    );

    const adoClient = agentConfig.getAdoClient();

    const codeCommentIds: number[] = [];
    // TODO: limit to 30 comments for now
    const revertedErrors = [...prReviewIssues.issues].slice(0, 30).reverse();
    for (const err of revertedErrors) {
      try {
        const commentThread = await adoClient.addCommentThreadForPRCode({
          repoId: prDetails.repoId,
          pullRequestId: prDetails.pullRequestId,
          comment: codeCommentHelper({
            issue: err.message,
            severity: err.severity,
            priority: err.priority,
            suggestion: err.suggestion,
            suggestionCode: err.suggestion_code,
            survey: true,
          }),
          filePath: err.file,
          filePosition: "right",
          fileStartLine: err.line,
          fileEndLine: err.line,
          fileStartOffset: 1,
          fileEndOffset: 1,
        });

        codeCommentIds.push(commentThread.id);
      } catch (error) {}
    }

    const mainCommentThread = await adoClient.addCommentForPR(
      prDetails.repoName,
      prDetails.pullRequestId,
      {
        approve: prReviewIssues.issues.length === 0,
        errors: prReviewIssues.issues,
      },
      codeSummary.codeChangeSummary,
      [],
      sonarqubeMeasures.measures,
    );

    await adoClient.setPullRequestProperties(
      prDetails.repoName,
      prDetails.pullRequestId,
      {
        [`/${CODE_REVIEW_AGENT_LATEST_REVIEW_ID}`]: String(
          prDetails.latestIterationId,
        ),
      },
    );

    return {
      mainCommentId: mainCommentThread.id,
      codeCommentIds,
    };
  },
});
