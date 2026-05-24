import { createWorkflow } from "@mastra/core";
import z from "zod";
import { CodeReviewIssueWithCategorySchema, PullRequestSchema } from "../types";
import { codeReview } from "./steps/code-review";
import { CodeReviewIssueClassificationStep } from "./steps/code-review-issue-classification";
import { codeReviewRescore } from "./steps/code-review-rescore";
import { filterIssues } from "./steps/filter-issues";
import { locateChanges } from "./steps/locate-changes";

const prReviewIssuesWorkflow = createWorkflow({
  id: "pr-review-issues-workflow",
  inputSchema: z.object({
    prDetails: PullRequestSchema,
  }),
  outputSchema: z.object({
    issues: z.array(CodeReviewIssueWithCategorySchema),
  }),
})
  .then(locateChanges)
  .then(codeReview)
  .then(filterIssues)
  .then(codeReviewRescore)
  .then(filterIssues)
  .then(CodeReviewIssueClassificationStep);

prReviewIssuesWorkflow.commit();

export { prReviewIssuesWorkflow };
