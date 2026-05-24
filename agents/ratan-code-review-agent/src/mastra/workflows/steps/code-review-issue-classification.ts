import { createStep } from "@mastra/core/workflows";
import z from "zod";
import { extractAgentConfig } from "../../../bootstrap/session";
import {
  type CodeReviewIssueClassification,
  CodeReviewIssueSchema,
  CodeReviewIssueWithCategorySchema,
  type CommonRequestContext,
} from "../../types";
import { UNCATEGORIZED } from "../../utils/const";

const CodeReviewIssueClassificationInputSchema = z.object({
  issues: z.array(CodeReviewIssueSchema),
});

const CodeReviewIssueClassificationResultSchema = z.object({
  issues: z.array(CodeReviewIssueWithCategorySchema),
});

export const CodeReviewIssueClassificationStep = createStep({
  id: "code-review-issue-classification",
  description: "Classify code review issues",
  inputSchema: CodeReviewIssueClassificationInputSchema,
  outputSchema: CodeReviewIssueClassificationResultSchema,
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

    const instructionsPrompt = await agentConfig.buildPrompt(
      "issue-classification",
    );

    const prompt = `
      ${instructionsPrompt}

      ## Code Review Issues

      <ISSUES>
      ${issues.map((i, index) => ({
        index,
        message: i.message,
        suggestion: i.suggestion,
      }))}
      </ISSUES>
    `;

    const codeReviewIssueClassificationAgent = mastra.getAgent(
      "codeReviewIssueClassificationAgent",
    );
    const output =
      await codeReviewIssueClassificationAgent.generate(prompt);

    const classificationResults =
      output.result as CodeReviewIssueClassification[];
    return {
      issues: issues.map((e, idx) => {
        const classificationResult = classificationResults.find(
          (r) => r.index === idx,
        );
        return {
          ...e,
          category: classificationResult?.category ?? UNCATEGORIZED,
          sub_category: classificationResult?.sub_category ?? UNCATEGORIZED,
        };
      }),
    };
  },
});
