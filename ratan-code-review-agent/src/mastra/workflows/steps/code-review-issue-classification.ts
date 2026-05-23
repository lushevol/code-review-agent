import { createStep } from "@mastra/core";
import z from "zod";
import { extractAgentConfig } from "../../../bootstrap/session";
import {
  type CodeReviewIssueClassification,
  CodeReviewIssueSchema,
  CodeReviewIssueWithCategorySchema,
  type CommonRuntimeContext,
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
  execute: async ({ inputData, mastra, runtimeContext }) => {
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
      runtimeContext as unknown as CommonRuntimeContext,
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
      await codeReviewIssueClassificationAgent.generateLegacy(prompt);

    const classificationResults =
      output.object as CodeReviewIssueClassification[];
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
