import type { RequestContext } from "@mastra/core/request-context";
import { type AdoPullRequest, AdoPullRequestSchema } from "ratan-ado-api";
import z from "zod";

export const CommonRequestContextSchema = z.object({
  configSessionId: z.string().describe("Agent Config Session Id"),
});

export type CommonRequestContext = RequestContext<
  z.infer<typeof CommonRequestContextSchema>
>;

export const CodeChangeSchema = z.object({
  changes: z.string(),
  newFilePath: z.string(),
  oldFilePath: z.string(),
  changeType: z.string(),
});

export const CodeChangesSchema = z.array(CodeChangeSchema);

export type CodeChanges = z.infer<typeof CodeChangesSchema>;

export const CodeReviewIssueSchema = z.object({
  file: z.string().describe("The file path of the error"),
  line: z.number().describe("The line number of the error"),
  severity: z
    .enum(["Critical", "High", "Medium", "Low"])
    .describe("Severity level of the issue"),
  priority: z
    .enum(["P1", "P2", "P3", "P4", "P5"])
    .describe("Priority level of the issue, P1 is highest, P5 is lowest"),
  message: z.string().describe("A description of the error"),
  suggestion: z
    .string()
    .describe("A suggestion to fix the error, if available"),
  suggestion_code: z
    .string()
    .describe("A code snippet that illustrates the suggestion, if available"),
  confidence_score: z
    .number()
    .describe(
      "A float number between 0 and 1 indicating the confidence level of the error detection",
    ),
});

export type CodeReviewIssue = z.infer<typeof CodeReviewIssueSchema>;

export const CodeReviewIssueWithCategorySchema = CodeReviewIssueSchema.extend({
  category: z.string(),
  sub_category: z.string(),
});

export type CodeReviewIssueWithCategory = z.infer<
  typeof CodeReviewIssueWithCategorySchema
>;

export const CodeReviewRescoreSchema = z.object({
  index: z.number().describe("the index of error"),
  confidence_score: z
    .number()
    .describe(
      "a float number between 0 and 1 indicating the confidence level of the error detection",
    ),
});

export type CodeReviewRescore = z.infer<typeof CodeReviewRescoreSchema>;

export const CodeReviewIssueClassificationSchema = z.object({
  index: z.number().describe("the index of error"),
  category: z.string().describe("The category of the issue"),
  sub_category: z.string().describe("The sub-category of the issue"),
});

export type CodeReviewIssueClassification = z.infer<
  typeof CodeReviewIssueClassificationSchema
>;

export const PullRequestSchema = AdoPullRequestSchema;
export type PullRequest = AdoPullRequest;
