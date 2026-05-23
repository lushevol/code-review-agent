import type { CodeReviewIssue } from "../types";

export const applyConfidenceScoreFilter = (
  issues: CodeReviewIssue[],
  minConfidenceScore: number,
): CodeReviewIssue[] => {
  return issues.filter((issue) => issue.confidence_score >= minConfidenceScore);
};
