import { type AgentConfigClient, createAgentConfigClient } from "./config";
import type { AgentConfigCreationOptions } from "./types";

type AgentSession = {
  id: string;
  options: Omit<
    AgentConfigCreationOptions,
    "adoToken" | "sonarQubeToken" | "ormConnectionUrl"
  >;
  config: AgentConfigClient;
};

export class AgentConfigSession {
  private agentConfigSessions: Map<string, AgentSession> = new Map();

  constructor() {}

  public async createAgentConfigSession(
    agentConfigCreationOptions: AgentConfigCreationOptions,
  ) {
    const agentConfigClient = await createAgentConfigClient(
      agentConfigCreationOptions,
    );
    const { adoToken, sonarQubeToken, ormConnectionUrl, ...restConfig } =
      agentConfigCreationOptions;
    this.agentConfigSessions.set(agentConfigClient.id, {
      config: agentConfigClient,
      options: restConfig,
      id: agentConfigClient.id,
    });
    return agentConfigClient;
  }

  public getAgentConfigSession(id: string): AgentSession | undefined {
    return this.agentConfigSessions.get(id);
  }

  public findOrCreateAgentConfigSession(
    agentConfigCreationOptions: AgentConfigCreationOptions,
  ) {
    for (const session of this.agentConfigSessions.values()) {
      if (
        JSON.stringify(session.options) ===
        JSON.stringify(agentConfigCreationOptions)
      ) {
        return session.config;
      }
    }
    return this.createAgentConfigSession(agentConfigCreationOptions);
  }

  public clearSessions() {
    this.agentConfigSessions.clear();
  }

  public clearSession(id: string) {
    this.agentConfigSessions.delete(id);
  }
}
