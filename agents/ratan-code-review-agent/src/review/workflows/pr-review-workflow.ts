import type { AgentRegistry, RequestContext } from "../runtime";
import { runSteps } from "../runtime";
import { scannerPipeline } from "./scanners/scanner-pipeline";
import { codeSummary } from "./steps/code-summary";
import { comment } from "./steps/comment";
import { createWorkItems } from "./steps/create-workitems";
import { fetchPR } from "./steps/fetch-pr";
import { fetchWorkItemContext } from "./steps/fetch-workitem-context";
import { locateChanges } from "./steps/locate-changes";
import { mergeGate } from "./steps/merge-gate";
import { recordAudit } from "./steps/record-audit";
import { sonarqubeMeasures } from "./steps/sonarqube-measures";

export interface PrReviewWorkflowOptions {
  inputData: {
    prId: number;
  };
  requestContext: RequestContext<any>;
  agents: AgentRegistry;
}

export async function* runPrReviewWorkflow(options: PrReviewWorkflowOptions) {
  const stepResults = new Map<string, unknown>();
  const events: Array<{ stepId: string; output: unknown }> = [];
  const onStepComplete = (event: { stepId: string; output: unknown }) => {
    events.push(event);
  };

  const emitEvents = function* () {
    while (events.length > 0) {
      yield events.shift();
    }
  };

  let current = await runSteps(
    [fetchPR, fetchWorkItemContext, locateChanges, scannerPipeline],
    options.inputData,
    {
      requestContext: options.requestContext,
      agents: options.agents,
      stepResults,
      onStepComplete,
    },
  );
  yield* emitEvents();

  const [summaryResult, measuresResult] = await Promise.all([
    codeSummary.execute({
      inputData: current,
      requestContext: options.requestContext,
      agents: options.agents,
      getStepResult: (id) => stepResults.get(id) as any,
    }),
    sonarqubeMeasures.execute({
      inputData: current,
      requestContext: options.requestContext,
      agents: options.agents,
      getStepResult: (id) => stepResults.get(id) as any,
    }),
  ]);

  stepResults.set(codeSummary.id, summaryResult);
  yield { stepId: codeSummary.id, output: summaryResult };
  stepResults.set(sonarqubeMeasures.id, measuresResult);
  yield { stepId: sonarqubeMeasures.id, output: measuresResult };

  current = {
    ...(current as Record<string, unknown>),
    ...(summaryResult as Record<string, unknown>),
    ...(measuresResult as Record<string, unknown>),
  };

  await runSteps(
    [mergeGate, recordAudit, createWorkItems, comment],
    current,
    {
      requestContext: options.requestContext,
      agents: options.agents,
      stepResults,
      onStepComplete,
    },
  );
  yield* emitEvents();
}
