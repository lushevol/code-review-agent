import { createStep } from "@mastra/core/workflows";
import z from "zod";
import { extractAgentConfig } from "../../../bootstrap/session";
import {
  CodeReviewIssueWithCategorySchema,
  type CommonRequestContext,
} from "../../types";
import { NormalizedFindingSchema } from "../../types/finding";
import { codeCommentHelper } from "../../utils/code-comment";
import { CODE_REVIEW_AGENT_LATEST_REVIEW_ID } from "../../utils/const";
import { reconcileFindings } from "../utils/finding-reconciler";
import { FindingStore } from "finding-store";
import type { PRDetailsResult } from "./fetch-pr";

const CommentInputSchema = z.object({
  "scanner-pipeline": z
    .object({
      findings: z.array(NormalizedFindingSchema),
      correlationSummary: z.string(),
    })
    .optional(),
  "pr-review-issues-workflow": z
    .object({
      issues: z.array(CodeReviewIssueWithCategorySchema),
    })
    .optional(),
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
  execute: async ({ inputData, requestContext, getStepResult }) => {
    if (!inputData) {
      throw new Error("Input data not found");
    }

    const { prDetails } = getStepResult("fetch-pr-details") as PRDetailsResult;

    const {
      "scanner-pipeline": scannerPipeline,
      "pr-review-issues-workflow": prReviewIssues,
      "code-summary": codeSummary,
      "sonarqube-measures": sonarqubeMeasures,
    } = inputData;

    const agentConfig = extractAgentConfig(
      requestContext as unknown as CommonRequestContext,
    );

    const adoClient = agentConfig.getAdoClient();

    // Use findings from scanner pipeline (new) or from old sub-workflow
    const findings = scannerPipeline?.findings ?? [];
    const oldIssues = prReviewIssues?.issues ?? [];

    // ── "Changes since last review" section ──────────────────────────
    let changesSinceLastReview = "";
    try {
      const rootConfig = await agentConfig.getRootConfig();
      const findingStorePath = rootConfig.findingStorePath ?? ".ratan/code-review-agent/findings.db";
      const findingStore = new FindingStore(findingStorePath);
      findingStore.init();
      const previousFindings = findingStore.getFindingsByPr(
        prDetails.pullRequestId,
        prDetails.repoName,
      );
      if (previousFindings.length > 0 && findings.length > 0) {
        const reconciled = reconcileFindings(previousFindings, findings);
        const parts: string[] = ["#### Changes since last review\n"];
        if (reconciled.findingsToResolve.length > 0) {
          parts.push(`✅ **${reconciled.findingsToResolve.length}** findings resolved`);
        }
        if (reconciled.findingsToSupersede.length > 0) {
          parts.push(`🔄 **${reconciled.findingsToSupersede.length}** findings updated`);
        }
        if (reconciled.findingsToCreate.length > 0) {
          parts.push(`🆕 **${reconciled.findingsToCreate.length}** new findings`);
        }
        if (parts.length > 1) {
          changesSinceLastReview = parts.join("\n- ") + "\n\n";
        }
      }
      findingStore.close();
    } catch {
      // FindingStore may not be configured — skip changes section
    }

    const codeCommentIds: number[] = [];

    // Post inline comments from scanner pipeline findings
    const findingsToComment = findings.slice(0, 30);
    for (const finding of findingsToComment) {
      if (!finding.filePath || finding.lineStart === null) continue;
      try {
        const commentText = `**${finding.severity.toUpperCase()}** - ${finding.title}` +
          (finding.description ? `\n\n${finding.description}` : "") +
          (finding.remediation ? `\n\n**Suggestion:** ${finding.remediation}` : "");
        const commentThread = await adoClient.addCommentThreadForPRCode({
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

        codeCommentIds.push(commentThread.id);
      } catch (error) {
        // Silently skip per-line comment failures
      }
    }

    // Fallback: post old-format comments if no scanner pipeline findings
    if (findings.length === 0) {
      const revertedErrors = [...oldIssues].slice(0, 30).reverse();
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
    }

    const mainCommentSummary = (changesSinceLastReview || "") +
      (scannerPipeline?.correlationSummary ??
        (oldIssues.length > 0
          ? `Found ${oldIssues.length} issues during code review.`
          : "No issues detected."));
    const mainCommentThread = await adoClient.addCommentForPR(
      prDetails.repoName,
      prDetails.pullRequestId,
      {
        approve: (findings.length === 0 && oldIssues.length === 0),
        errors: oldIssues,
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
