import { createAgentConfigClient } from "./config";
import type { AgentConfigCreationOptions, ConfigProvider } from "./types";

export type AgentSession = {
  id: string;
  config: ConfigProvider;
};

export class AgentConfigSession {
  private agentConfigSessions: Map<string, AgentSession> = new Map();

  constructor() {}

  public async createAgentConfigSession(
    agentConfigCreationOptions: AgentConfigCreationOptions,
  ): Promise<ConfigProvider> {
    const agentConfigClient = await createAgentConfigClient(
      agentConfigCreationOptions,
    );
    this.agentConfigSessions.set(agentConfigClient.id, {
      config: agentConfigClient,
      id: agentConfigClient.id,
    });
    return agentConfigClient;
  }

  public registerProvider(provider: ConfigProvider): ConfigProvider {
    this.agentConfigSessions.set(provider.id, {
      config: provider,
      id: provider.id,
    });
    return provider;
  }

  public getAgentConfigSession(id: string): AgentSession | undefined {
    return this.agentConfigSessions.get(id);
  }

  public clearSessions() {
    this.agentConfigSessions.clear();
  }

  public clearSession(id: string) {
    this.agentConfigSessions.delete(id);
  }
}
