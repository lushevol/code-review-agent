import { extractAgentConfig } from "../../bootstrap/session";
import {
  selectReviewFocuses,
  type ReviewFocusSelection,
} from "../open-code-review/review-focus-router";
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
import { recordMetrics } from "./steps/record-metrics";
import { sonarqubeMeasures } from "./steps/sonarqube-measures";
import { getLogger } from "ratan-logger";

export interface PrReviewWorkflowOptions {
  inputData: { prId: number };
  requestContext: RequestContext<any>;
}

export async function* runPrReviewWorkflow(options: PrReviewWorkflowOptions) {
  const events: Array<{ stepId: string; output: unknown }> = [];
  const onStepComplete = (event: { stepId: string; output: unknown }) => {
    events.push(event);
  };
  const emitEvents = function* () {
    while (events.length > 0) yield events.shift();
  };
  const stepOptions = {
    requestContext: options.requestContext,
    onStepComplete,
  };

  const workflowLogger = getLogger("review");
  const startedAt = Date.now();

  workflowLogger.info("review.started", {
    prId: options.inputData.prId,
  });
  let current = (await runSteps(
    [fetchPR, fetchWorkItemContext],
    options.inputData,
    stepOptions,
  )) as Record<string, any>;
  yield* emitEvents();
  workflowLogger.info("review.step.completed", {
    step: "fetch-context",
    prId: current.prDetails?.pullRequestId,
    repo: current.prDetails?.repoName,
  });

  const agentConfig = extractAgentConfig(
    options.requestContext as unknown as CommonRequestContext,
  );
  const rootConfig = await agentConfig.getRootConfig();
  const workspaceProvider = new LocalReviewWorkspaceProvider({
    workspaceRoot: rootConfig.openCodeReview?.workspaceRoot,
    adoToken: agentConfig.getAdoClient().getAdoToken(),
    maxGitOutputBytes: rootConfig.workspace?.maxGitOutputBytes,
    useSsh: rootConfig.workspace?.useSsh,
  });
  let attemptedReviewFocuses: ReviewFocusSelection[] = [];
  let reviewAttemptStartedAt: number | undefined;

  try {
    current = await workspaceProvider.withWorkspace(
      current.prDetails,
      async (workspace) => {
        attemptedReviewFocuses = selectReviewFocuses(workspace.changes);
        reviewAttemptStartedAt = Date.now();
        workflowLogger.info("review.step.completed", {
          step: "workspace-setup",
          prId: current.prDetails?.pullRequestId,
          repo: current.prDetails?.repoName,
          changedFiles: workspace.changes.length,
          focuses: attemptedReviewFocuses.map((f) => f.focus).join(","),
        });
        workflowLogger.info("review.step.completed", {
          step: "scanner-pipeline-start",
          prId: current.prDetails?.pullRequestId,
        });
        return (await runSteps(
          [scannerPipeline],
          { ...current, workspace },
          stepOptions,
        )) as Record<string, any>;
      },
    );
  } catch (error) {
    workflowLogger.error(
      "review.pipeline.failed",
      {
        error,
        prId: current.prDetails?.pullRequestId,
        repo: current.prDetails?.repoName,
      },
    );
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
      reviewMetadata: {
        status: "failed",
        durationMs:
          reviewAttemptStartedAt === undefined
            ? 0
            : Math.max(1, Date.now() - reviewAttemptStartedAt),
        reviewFocuses: attemptedReviewFocuses,
      },
      changesSinceLastReview: "",
    };
    yield { stepId: scannerPipeline.id, output: current };
  }
  yield* emitEvents();
  workflowLogger.info("review.step.completed", {
    step: "scanner-pipeline",
    prId: current.prDetails?.pullRequestId,
    findings: current.findings?.length ?? 0,
    reviewExecutionStatus: current.reviewExecutionStatus,
  });

  workflowLogger.info("review.step.completed", {
    step: "sonarqube-measures-start",
    prId: current.prDetails?.pullRequestId,
  });
  const measuresResult = await runSteps(
    [sonarqubeMeasures],
    current,
    stepOptions,
  );
  yield* emitEvents();
  current = { ...current, ...(measuresResult as Record<string, unknown>) };
  workflowLogger.info("review.step.completed", {
    step: "sonarqube-measures",
    prId: current.prDetails?.pullRequestId,
  });

  workflowLogger.info("review.step.completed", {
    step: "finalize-start",
    prId: current.prDetails?.pullRequestId,
  });
  await runSteps(
    [recordMetrics, mergeGate, recordAudit, createWorkItems, comment],
    current,
    stepOptions,
  );
  yield* emitEvents();

  workflowLogger.info("review.finished", {
    prId: current.prDetails?.pullRequestId,
    repo: current.prDetails?.repoName,
    durationMs: Math.max(1, Date.now() - startedAt),
    findings: current.findings?.length ?? 0,
    mergeDecision: current.mergeDecision,
  });
}
