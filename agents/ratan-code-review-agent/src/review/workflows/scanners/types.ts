import type { ConfigProvider } from "agent-config-manager";
import type { FindingStore } from "finding-store";
import type { AzureDevOps, AdoPullRequest } from "ratan-ado-api";
import type { SonarQubeClient } from "ratan-sonarqube-api";
import type { AgentRegistry } from "../../runtime";
import type { EngineType, NormalizedFinding } from "../../types/finding";

export interface Scanner {
  readonly id: string;
  readonly engine: EngineType;
  scan(
    prDetails: AdoPullRequest,
    context: ScanContext,
  ): Promise<{ findings: NormalizedFinding[]; engine: EngineType; durationMs: number }>;
}

export interface ScanContext {
  provider: ConfigProvider;
  adoClient: AzureDevOps;
  sonarClient?: SonarQubeClient | null;
  findingStore: FindingStore;
  agents: AgentRegistry;
  workItemContext?: string;
}
