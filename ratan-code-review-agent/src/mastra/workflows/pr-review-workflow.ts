import { createWorkflow } from "@mastra/core";
import z from "zod";
import { prReviewIssuesWorkflow } from "./pr-review-issues-workflow";
import { codeSummary } from "./steps/code-summary";
import { comment } from "./steps/comment";
import { fetchPR } from "./steps/fetch-pr";
import { sonarqubeMeasures } from "./steps/sonarqube-measures";

const prReviewWorkflow = createWorkflow({
  id: "pr-review-workflow",
  inputSchema: z.object({
    prId: z.number().describe("The ID of the pull request"),
  }),
  outputSchema: z.object({
    activities: z.string(),
  }),
})
  .then(fetchPR)
  .parallel([prReviewIssuesWorkflow, codeSummary, sonarqubeMeasures])
  .then(comment);

prReviewWorkflow.commit();

export { prReviewWorkflow };
