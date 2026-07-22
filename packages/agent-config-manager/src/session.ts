import type { ConfigProvider } from "./types";

export type AgentSession = {
  id: string;
  config: ConfigProvider;
};

export class AgentConfigSession {
  private agentConfigSessions: Map<string, AgentSession> = new Map();

  constructor() {}

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
