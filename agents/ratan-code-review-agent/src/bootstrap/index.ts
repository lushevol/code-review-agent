import { RequestContext } from "@mastra/core/request-context";
import type { AgentConfigCreationOptions, ConfigProvider } from "agent-config-manager";
import { mastra } from "../mastra";
import type { CommonRequestContext } from "../mastra/types";
import { scanPRs } from "./pr-scan";
import { getAgentConfigSessions } from "./session";

// Keep the original startup for backwards compat (demo.ts, evaluation)
export const startup = async (startupOptions: AgentConfigCreationOptions) => {
  console.log("[startup] Starting up agent ...");

  const agentConfig =
    await getAgentConfigSessions().createAgentConfigSession(startupOptions);

  await runScanLoop(agentConfig);
};

// New function for CLI — accepts a pre-created ConfigProvider
export const startScanWithProvider = async (provider: ConfigProvider) => {
  console.log("[startScanWithProvider] Starting scan with provider ...");

  const registered = getAgentConfigSessions().registerProvider(provider);

  await runScanLoop(registered);
};

async function runScanLoop(agentConfig: ConfigProvider) {
  console.log("[startup] Agent config session created:", agentConfig.id);

  const pendingPR$ = scanPRs({
    requestContext: { configSessionId: agentConfig.id },
  });

  console.log("[startup] Subscribing to pending PRs stream...");

  pendingPR$.subscribe(async ({ prId }) => {
    console.log(`[startup] Received pending PR: ${prId}`);
    const prReviewWorkflow = mastra.getWorkflow("prReviewWorkflow");
    const run = prReviewWorkflow.createRun();

    console.log(`[startup] Running prReviewWorkflow for PR: ${prId}`);

    const requestContext: CommonRequestContext = new RequestContext();
    requestContext.set("configSessionId", agentConfig.id);
    const result = run.stream({
      inputData: {
        prId,
      },
      requestContext: requestContext as RequestContext,
    });

    for await (const output of result.fullStream) {
      console.log("PR Review Workflow Output:", output);
    }
    console.log(`[startup] Finished processing PR: ${prId}`);
  });
}

export const startupEvaluation = async (
  startupOptions: AgentConfigCreationOptions,
) => {
  console.log("[startupEvaluation] Starting up evaluation mode...");
  const agentConfig =
    await getAgentConfigSessions().createAgentConfigSession(startupOptions);

  console.log("[startup] Agent config session created:", agentConfig.id);

  const codeReviewEvaluationJudgeAgent = mastra.getAgent(
    "codeReviewEvaluationJudgeAgent",
  );

  // Here you can add code to run evaluations using codeReviewEvaluationJudgeAgent
  console.log("[startupEvaluation] Evaluation mode is not yet implemented.");
};
