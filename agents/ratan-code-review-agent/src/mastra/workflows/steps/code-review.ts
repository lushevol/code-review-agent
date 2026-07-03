import { createStep } from "@mastra/core/workflows";
import z from "zod";
import { extractAgentConfig } from "../../../bootstrap/session";
import {
  type CodeReviewIssue,
  CodeReviewIssueSchema,
  type CommonRequestContext,
  PullRequestSchema,
} from "../../types";
import { chunkContent } from "../../utils/chunk-content";
import { MAX_CHARACTER } from "../../utils/const";
import { extractFileExtension } from "../../utils/file-utils";
import { sortIssues } from "../../utils/sort-issues";

const CodeReviewInputSchema = z.object({
  prDetails: PullRequestSchema,
});

const CodeReviewResultSchema = z.object({
  issues: z.array(CodeReviewIssueSchema),
});

export const codeReview = createStep({
  id: "code-review",
  description: "Reviews code changes and provides feedback",
  inputSchema: CodeReviewInputSchema,
  outputSchema: CodeReviewResultSchema,
  execute: async ({ inputData, requestContext, mastra }) => {
    if (!inputData) {
      throw new Error("Input data not found");
    }

    const {
      prDetails: { codeDiffsArray, repoName },
    } = inputData;
    const agentConfig = extractAgentConfig(
      requestContext as unknown as CommonRequestContext,
    );
    const issues: CodeReviewIssue[] = [];

    for (const change of codeDiffsArray) {
      if (change.changes.length === 0) {
        continue;
      }
      const chunks: string[] = chunkContent(change.changes, MAX_CHARACTER);
      for (const chunk of chunks) {
        const instructionsPrompt = await agentConfig.buildPrompt("review", {
          pathVars: {
            repo: repoName,
            extension: extractFileExtension(change.newFilePath),
          },
        });
        const codeReviewAgent = mastra.getAgent("codeReviewAgent");

        const prompt = `
          ${instructionsPrompt}

          ## Code Changes

          <CODE_CHANGES>
          ${chunk}
          </CODE_CHANGES>
        `;

        const output = await codeReviewAgent.generate(prompt);
        const reviewIssues = output.object as CodeReviewIssue[];
        reviewIssues.forEach(
          (i) => (i.file = change.newFilePath ?? change.oldFilePath ?? i.file),
        );
        issues.push(...reviewIssues);
      }
    }

    return {
      issues: sortIssues(issues),
    };
  },
});
