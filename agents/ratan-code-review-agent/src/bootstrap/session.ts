import { RequestContext } from "@mastra/core/request";
import { AgentConfigSession } from "agent-config-manager";
import type z from "zod";
import type {
  CommonRequestContext,
  CommonRequestContextSchema,
} from "../mastra/types";

const agentConfigSessions = new AgentConfigSession();

export const getAgentConfigSessions = () => {
  return agentConfigSessions;
};

export const extractAgentConfig = (
  requestContext:
    | z.infer<typeof CommonRequestContextSchema>
    | CommonRequestContext,
) => {
  const configSessionId =
    requestContext instanceof RequestContext
      ? requestContext.get("configSessionId")
      : requestContext.configSessionId;

  const agentConfig =
    agentConfigSessions.getAgentConfigSession(configSessionId);
  if (!agentConfig) {
    throw new Error(
      `Agent config session not found for id: ${configSessionId}`,
    );
  }

  return agentConfig.config;
};
