export type CodeReviewIssue = {
  file: string;
  line: number;
  severity: string;
  priority: string;
  message: string;
  suggestion: string;
  suggestion_code: string;
  confidence_score: number;
  category: string;
  sub_category: string;
};
