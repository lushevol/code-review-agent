import { RuntimeContext } from "@mastra/core/runtime-context";
import type { AgentConfigCreationOptions } from "agent-config-manager";
import { mastra } from "../mastra";
import type { CommonRuntimeContext } from "../mastra/types";
import { scanPRs } from "./pr-scan";
import { getAgentConfigSessions } from "./session";

export const startup = async (startupOptions: AgentConfigCreationOptions) => {
  console.log("[startup] Starting up agent ...");

  const agentConfig =
    await getAgentConfigSessions().createAgentConfigSession(startupOptions);

  console.log("[startup] Agent config session created:", agentConfig.id);

  const pendingPR$ = scanPRs({
    runtimeContext: { configSessionId: agentConfig.id },
  });

  console.log("[startup] Subscribing to pending PRs stream...");

  pendingPR$.subscribe(async ({ prId }) => {
    console.log(`[startup] Received pending PR: ${prId}`);
    const prReviewWorkflow = mastra.getWorkflow("prReviewWorkflow");
    const run = await prReviewWorkflow.createRunAsync();

    console.log(`[startup] Running prReviewWorkflow for PR: ${prId}`);

    const runtimeContext: CommonRuntimeContext = new RuntimeContext();
    runtimeContext.set("configSessionId", agentConfig.id);
    const result = run.stream({
      inputData: {
        prId,
      },
      runtimeContext: runtimeContext as RuntimeContext,
    });

    for await (const output of result.fullStream) {
      console.log("PR Review Workflow Output:", output);
    }
    console.log(`[startup] Finished processing PR: ${prId}`);
  });
};

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
