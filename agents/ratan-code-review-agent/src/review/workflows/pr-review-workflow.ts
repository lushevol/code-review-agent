import { extractAgentConfig } from "../../bootstrap/session";
import type { RequestContext } from "../runtime";
import { runSteps } from "../runtime";
import type { CommonRequestContext } from "../types";
import { LocalReviewWorkspaceProvider } from "../workspace/local-review-workspace";
import { scannerPipeline } from "./scanners/scanner-pipeline";
import { comment } from "./steps/comment";
import { createWorkItems } from "./steps/create-workitems";
import { fetchPR } from "./steps/fetch-pr";
import { fetchWorkItemContext } from "./steps/fetch-workitem-context";
import { mergeGate } from "./steps/merge-gate";
import { recordAudit } from "./steps/record-audit";
import { sonarqubeMeasures } from "./steps/sonarqube-measures";

export interface PrReviewWorkflowOptions {
  inputData: { prId: number };
  requestContext: RequestContext<any>;
}

const noAgents = {
  getAgent() {
    throw new Error("Legacy review agents are not available in the PR review runtime");
  },
};

export async function* runPrReviewWorkflow(options: PrReviewWorkflowOptions) {
  const stepResults = new Map<string, unknown>();
  const events: Array<{ stepId: string; output: unknown }> = [];
  const onStepComplete = (event: { stepId: string; output: unknown }) => {
    events.push(event);
  };
  const emitEvents = function* () {
    while (events.length > 0) yield events.shift();
  };
  const stepOptions = {
    requestContext: options.requestContext,
    stepResults,
    onStepComplete,
  };

  let current = (await runSteps(
    [fetchPR, fetchWorkItemContext],
    options.inputData,
    stepOptions,
  )) as Record<string, any>;
  yield* emitEvents();

  const agentConfig = extractAgentConfig(
    options.requestContext as unknown as CommonRequestContext,
  );
  const rootConfig = await agentConfig.getRootConfig();
  const workspaceProvider = new LocalReviewWorkspaceProvider({
    workspaceRoot: rootConfig.openCodeReview?.workspaceRoot,
    adoToken: agentConfig.getAdoClient().getAdoToken(),
  });

  try {
    current = await workspaceProvider.withWorkspace(
      current.prDetails,
      async (workspace) =>
        (await runSteps(
          [scannerPipeline],
          { ...current, workspace },
          stepOptions,
        )) as Record<string, any>,
    );
  } catch {
    current = {
      ...current,
      findings: [],
      correlationSummary: "OpenCodeReview could not be completed.",
      reviewSummary: [
        `Base: ${current.prDetails.latestTargetCommitId}`,
        `Head: ${current.prDetails.latestSourceCommitId}`,
        "OCR status: failed",
      ].join("\n"),
      reviewExecutionStatus: "incomplete",
      reviewMetadata: { status: "failed", durationMs: 0 },
      changesSinceLastReview: "",
    };
    stepResults.set(scannerPipeline.id, current);
    yield { stepId: scannerPipeline.id, output: current };
  }
  yield* emitEvents();

  const measuresResult = await sonarqubeMeasures.execute({
    inputData: current,
    requestContext: options.requestContext,
    agents: noAgents,
    getStepResult: (id) => stepResults.get(id),
  });
  stepResults.set(sonarqubeMeasures.id, measuresResult);
  yield { stepId: sonarqubeMeasures.id, output: measuresResult };
  current = { ...current, ...(measuresResult as Record<string, unknown>) };

  await runSteps(
    [mergeGate, recordAudit, createWorkItems, comment],
    current,
    stepOptions,
  );
  yield* emitEvents();
}
