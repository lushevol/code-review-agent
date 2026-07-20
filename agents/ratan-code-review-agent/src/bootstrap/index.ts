import type { ConfigProvider } from "agent-config-manager";
import { runPrReviewWorkflow } from "../review/workflows/pr-review-workflow";
import { ReviewTracker } from "../review/workflows/utils/review-tracker";
import { RequestContext } from "../review/runtime";
import type { CommonRequestContext } from "../review/types";
import { scanPRs } from "./pr-scan";
import { getAgentConfigSessions } from "./session";

export const startScanWithProvider = async (provider: ConfigProvider) => {
  console.log("[startScanWithProvider] Starting scan with provider ...");

  const registered = getAgentConfigSessions().registerProvider(provider);

  await runScanLoop(registered);
};

export const startReviewPrWithProvider = async (
  provider: ConfigProvider,
  prId: number,
) => {
  console.log(`[startReviewPrWithProvider] Reviewing PR: ${prId}`);

  const registered = getAgentConfigSessions().registerProvider(provider);

  await runReviewWorkflow(registered, prId);
};

async function runScanLoop(agentConfig: ConfigProvider) {
  console.log("[startup] Agent config session created:", agentConfig.id);

  const pendingPR$ = scanPRs({
    requestContext: { configSessionId: agentConfig.id },
  });

  console.log("[startup] Subscribing to pending PRs stream...");

  pendingPR$.subscribe(async ({ prId }) => {
    console.log(`[startup] Received pending PR: ${prId}`);
    await runReviewWorkflow(agentConfig, prId);
  });
}

async function runReviewWorkflow(agentConfig: ConfigProvider, prId: number) {
  console.log(`[startup] Running prReviewWorkflow for PR: ${prId}`);
  const reviewSignal = ReviewTracker.startReview(prId);

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
        console.log(`[startup] Stopped stale review for PR: ${prId}`);
        return;
      }
      console.log("PR Review Workflow Output:", output);
    }
    console.log(`[startup] Finished processing PR: ${prId}`);
  } finally {
    ReviewTracker.finishReview(prId, reviewSignal);
  }
}
