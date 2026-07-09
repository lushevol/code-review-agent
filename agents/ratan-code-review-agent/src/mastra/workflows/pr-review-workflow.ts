import { createWorkflow } from "@mastra/core/workflows";
import z from "zod";
import { codeSummary } from "./steps/code-summary";
import { comment } from "./steps/comment";
import { fetchPR } from "./steps/fetch-pr";
import { fetchWorkItemContext } from "./steps/fetch-workitem-context";
import { locateChanges } from "./steps/locate-changes";
import { sonarqubeMeasures } from "./steps/sonarqube-measures";
import { scannerPipeline } from "./scanners/scanner-pipeline";
import { mergeGate } from "./steps/merge-gate";
import { createWorkItems } from "./steps/create-workitems";
import { mergeParallelResults } from "./steps/merge-parallel-results";
import { recordAudit } from "./steps/record-audit";

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
  .then(fetchWorkItemContext)
  .then(locateChanges)
  .then(scannerPipeline)
  .parallel([codeSummary, sonarqubeMeasures])
  .then(mergeParallelResults)
  .then(mergeGate)
  .then(recordAudit)
  .then(createWorkItems)
  .then(comment);

prReviewWorkflow.commit();

export { prReviewWorkflow };
