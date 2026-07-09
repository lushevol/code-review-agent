import { defineStep } from "../../runtime";
import z from "zod";
import { CodeReviewIssueSchema } from "../../types";
import { applyConfidenceScoreFilter } from "../../utils/confidence-score-filter";
import { CONFIDENCE_SCORE_THRESHOLD } from "../../utils/const";

const FilterIssuesInputSchema = z.object({
  issues: z.array(CodeReviewIssueSchema),
});

const FilterIssuesResultSchema = z.object({
  issues: z.array(CodeReviewIssueSchema),
});

export const filterIssues = defineStep({
  id: "filter-issues",
  description: "Filter issues based on confidence score",
  inputSchema: FilterIssuesInputSchema,
  outputSchema: FilterIssuesResultSchema,
  execute: async ({ inputData }) => {
    if (!inputData) {
      throw new Error("Input data not found");
    }

    const issues = inputData.issues;

    return {
      issues: applyConfidenceScoreFilter(issues, CONFIDENCE_SCORE_THRESHOLD),
    };
  },
});
