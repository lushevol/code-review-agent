import { createStep } from "@mastra/core/workflows";
import z from "zod";
import { extractAgentConfig } from "../../../bootstrap/session";
import {
  CodeReviewIssueSchema,
  type CodeReviewRescore,
  type CommonRequestContext,
} from "../../types";

const CodeReviewRescoreInputSchema = z.object({
  issues: z.array(CodeReviewIssueSchema),
});

const CodeReviewRescoreResultSchema = z.object({
  issues: z.array(CodeReviewIssueSchema),
});

export const codeReviewRescore = createStep({
  id: "code-review-rescore",
  description: "Rescore code review issues based on confidence score",
  inputSchema: CodeReviewRescoreInputSchema,
  outputSchema: CodeReviewRescoreResultSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    if (!inputData) {
      throw new Error("Input data not found");
    }

    const issues = inputData.issues;

    if (issues.length === 0) {
      return {
        issues: [],
      };
    }

    const agentConfig = extractAgentConfig(
      requestContext as unknown as CommonRequestContext,
    );

    const instructionsPrompt = await agentConfig.buildPrompt("review-rescore");

    const prompt = `
      ${instructionsPrompt}

      ## Code Review Issues

      <ISSUES>
      ${issues.map((i, index) => ({
        index,
        message: i.message,
        suggestion: i.suggestion,
        suggestion_code: i.suggestion_code,
      }))}
      </ISSUES>
    `;

    const codeReviewRescoreAgent = mastra.getAgent("codeReviewRescoreAgent");
    const output = await codeReviewRescoreAgent.generate(prompt);

    const rerankResults = output.result as CodeReviewRescore[];
    return {
      issues: issues.map((e, idx) => {
        const rerankResult = rerankResults.find((r) => r.index === idx);
        return {
          ...e,
          confidence_score:
            rerankResult?.confidence_score ?? e.confidence_score,
        };
      }),
    };
  },
});
