import type { ConfigProvider } from "agent-config-manager";
import { runPrReviewWorkflow } from "../review/workflows/pr-review-workflow";
import { ReviewTracker } from "../review/workflows/utils/review-tracker";
import { RequestContext } from "../review/runtime";
import type { CommonRequestContext } from "../review/types";
import { getAgentConfigSessions } from "./session";
import { getLogger } from "ratan-logger";

const logger = getLogger("review");

function getReviewExecutionStatus(output: unknown): "complete" | "incomplete" | undefined {
  if (!output || typeof output !== "object") return undefined;
  const status = (output as Record<string, unknown>).reviewExecutionStatus;
  return status === "complete" || status === "incomplete" ? status : undefined;
}

export const startReviewPrWithProvider = async (
  provider: ConfigProvider,
  prId: number,
) => {
  const registered = getAgentConfigSessions().registerProvider(provider);

  await runReviewWorkflow(registered, prId);
};

async function runReviewWorkflow(agentConfig: ConfigProvider, prId: number) {
  const startedAt = Date.now();
  logger.info("review.started", { prId });
  const reviewSignal = ReviewTracker.startReview(prId);
  let reviewStatus: "complete" | "incomplete" = "complete";

  const requestContext: CommonRequestContext = new RequestContext();
  requestContext.set("configSessionId", agentConfig.id);

  try {
    for await (const output of runPrReviewWorkflow({
      inputData: {
        prId,
      },
      requestContext,
    })) {
      if (reviewSignal.aborted) {
        logger.warn("review.stale", { prId });
        return;
      }
      const stepStatus = getReviewExecutionStatus(output.output);
      if (stepStatus) reviewStatus = stepStatus;
      logger.info("review.step.completed", {
        prId,
        step: output.stepId,
        ...(stepStatus ? { status: stepStatus } : {}),
      });
    }
    logger.info("review.finished", {
      prId,
      status: reviewStatus,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    logger.error("review.failed", { prId, error });
    throw error;
  } finally {
    ReviewTracker.finishReview(prId, reviewSignal);
  }
}
