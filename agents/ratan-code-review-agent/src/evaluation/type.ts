import z from "zod";
import {
  CodeChangeSchema,
  CodeReviewIssueWithCategorySchema,
} from "../mastra/types";

const CodeReviewIssueForTestSchema = CodeReviewIssueWithCategorySchema.omit({
  severity: true,
  priority: true,
  category: true,
  sub_category: true,
  confidence_score: true,
});

export const codeChangesReviewTestCaseSchema = z.object({
  id: z.string().describe("The unique identifier for the test case"),
  input: z.object({
    codeChange: CodeChangeSchema,
  }),
  expectedOutput: z.object({
    issues: z.array(CodeReviewIssueForTestSchema),
  }),
});

export const codeChangesReviewTestResultSchema = z.object({
  id: z.string().describe("The unique identifier for the test case"),
  actualOutput: z.object({
    issues: z.array(CodeReviewIssueForTestSchema),
  }),
});

export const aiJudgeInputSchema = codeChangesReviewTestCaseSchema
  .omit({ id: true })
  .extend({
    actualIssue: CodeReviewIssueForTestSchema,
    isMatchedExpectation: z
      .boolean()
      .describe("Whether the issue matched an expected issue"),
  });

export type AIJudgeInput = z.infer<typeof aiJudgeInputSchema>;

export const aiJudgeOutputSchema = z.object({
  is_valid: z
    .boolean()
    .describe("Whether the found issue is valid or a hallucination"),
  suggestion_quality: z
    .number()
    .min(1)
    .max(5)
    .describe("1.0 to 5.0: Quality of the suggestion provided for this issue"),
  judge_reasoning: z
    .string()
    .describe("The reasoning provided by the judge for this issue"),
});

export const codeChangesReviewEvaluationResultSchema = z.object({
  id: z.string().describe("The unique identifier for the test case"),
  missed_issue_index: z
    .array(z.number())
    .describe("Indices of expected issues that were missed"),
  actualOutputEvaluation: z.array(
    aiJudgeOutputSchema.extend({
      index: z.number().describe("Index of the regression found issue"),
    }),
  ),
  metrics: z.object({
    accuracy_score: z
      .number()
      .min(0)
      .max(1)
      .describe("0.0 to 1.0: Percentage of expected issues that were found"),
    false_negative_rate: z
      .number()
      .min(0)
      .max(1)
      .describe("0.0 to 1.0: Percentage of expected issues missed"),
    false_positive_rate: z
      .number()
      .min(0)
      .max(1)
      .describe(
        "0.0 to 1.0: Percentage of found issues that were invalid (Hallucinations)",
      ),
    suggestion_quality_rate: z
      .number()
      .min(1)
      .max(5)
      .describe("1.0 to 5.0: Average quality score of the valid suggestions"),
  }),
});
