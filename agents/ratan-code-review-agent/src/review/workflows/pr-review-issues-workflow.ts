import type { AgentRegistry, RequestContext } from "../runtime";
import { runSteps } from "../runtime";
import { CodeReviewIssueClassificationStep } from "./steps/code-review-issue-classification";
import { codeReview } from "./steps/code-review";
import { codeReviewRescore } from "./steps/code-review-rescore";
import { filterIssues } from "./steps/filter-issues";
import { locateChanges } from "./steps/locate-changes";

export async function runPrReviewIssuesWorkflow(options: {
  inputData: unknown;
  requestContext: RequestContext<any>;
  agents: AgentRegistry;
}) {
  return runSteps(
    [
      locateChanges,
      codeReview,
      filterIssues,
      codeReviewRescore,
      filterIssues,
      CodeReviewIssueClassificationStep,
    ],
    options.inputData,
    {
      requestContext: options.requestContext,
      agents: options.agents,
    },
  );
}
