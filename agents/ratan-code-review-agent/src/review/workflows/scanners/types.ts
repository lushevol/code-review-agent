import type { ConfigProvider } from "agent-config-manager";
import type { FindingStore } from "finding-store";
import type { AzureDevOps, AdoPullRequestMetadata } from "ratan-ado-api";
import type { SonarQubeClient } from "ratan-sonarqube-api";
import type { AgentRegistry } from "../../runtime";
import type { OcrReviewRunner } from "../../open-code-review/runner";
import type { ReviewWorkspace } from "../../workspace/types";
import type { EngineType, NormalizedFinding } from "../../types/finding";

export interface Scanner {
  readonly id: string;
  readonly engine: EngineType;
  scan(
    prDetails: AdoPullRequestMetadata,
    context: ScanContext,
  ): Promise<ScannerResult>;
}

export type ReviewExecutionStatus = "complete" | "incomplete";

export interface ScannerResult {
  findings: NormalizedFinding[];
  engine: EngineType;
  durationMs: number;
  executionStatus?: ReviewExecutionStatus;
  metadata?: Record<string, unknown>;
}

export interface ScanContext {
  provider: ConfigProvider;
  adoClient: AzureDevOps;
  sonarClient?: SonarQubeClient | null;
  findingStore: FindingStore;
  agents: AgentRegistry;
  workItemContext?: string;
  workspace: ReviewWorkspace;
  ocrRunner: OcrReviewRunner;
}
