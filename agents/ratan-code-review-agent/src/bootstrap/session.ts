import { RuntimeContext } from "@mastra/core/runtime-context";
import { AgentConfigSession } from "agent-config-manager";
import type z from "zod";
import type {
  CommonRuntimeContext,
  CommonRuntimeContextSchema,
} from "../mastra/types";

const agentConfigSessions = new AgentConfigSession();

export const getAgentConfigSessions = () => {
  return agentConfigSessions;
};

export const extractAgentConfig = (
  runtimeContext:
    | z.infer<typeof CommonRuntimeContextSchema>
    | CommonRuntimeContext,
) => {
  const configSessionId =
    runtimeContext instanceof RuntimeContext
      ? runtimeContext.get("configSessionId")
      : runtimeContext.configSessionId;

  const agentConfig =
    agentConfigSessions.getAgentConfigSession(configSessionId);
  if (!agentConfig) {
    throw new Error(
      `Agent config session not found for id: ${configSessionId}`,
    );
  }

  return agentConfig.config;
};
