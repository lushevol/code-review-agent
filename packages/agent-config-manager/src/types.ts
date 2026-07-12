import type { AzureDevOps } from "ratan-ado-api";
import type { SonarQubeClient } from "ratan-sonarqube-api";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { schema } from "ratan-code-review-agent-orm";
import { z } from "zod";

const CveScannerSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  sonarqubeProjectKey: z.string().optional(),
});

const ComplianceScannerSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  rulesPath: z.string().optional(),
});

const ScannerSettingsSchema = z.object({
  cve: CveScannerSettingsSchema.optional(),
  compliance: ComplianceScannerSettingsSchema.optional(),
});

const OverrideAuthRulesSchema = z.object({
  criticalRequiresTwoPerson: z.boolean().optional(),
});

const MergePolicySchema = z.object({
  defaultBlockingSeverities: z.array(z.string()).optional(),
  overrideAuthRules: OverrideAuthRulesSchema.optional(),
});

const WebhookConfigSchema = z.object({
  enabled: z.boolean().optional(),
  port: z.number().optional(),
});

const DashboardConfigSchema = z.object({
  enabled: z.boolean().optional(),
  port: z.number().optional(),
});

const RemediationTasksConfigSchema = z.object({
  enabled: z.boolean().optional(),
});

const AuditConfigSchema = z.object({
  retentionDays: z.number().optional(),
});

const FeedbackDaemonConfigSchema = z.object({
  enabled: z.boolean().optional(),
  intervalMs: z.number().optional(),
});

const OpenCodeReviewLlmConfigSchema = z.object({
  url: z.string().url(),
  token: z.string().min(1),
  model: z.string().min(1),
  useAnthropic: z.boolean().optional().default(false),
});

const OpenCodeReviewConfigSchema = z.object({
  workspaceRoot: z.string().optional(),
  rulesPath: z.string().min(1),
  llm: OpenCodeReviewLlmConfigSchema,
});

/**
 * Full agent config with defaults and optional repo-specific overrides.
 */
export const RootAgentConfigSchema = z.object({
  scanPRCreatedDaysAgo: z.number().optional(),
  scanRepoNames: z.array(z.string()).optional(),
  openCodeReview: OpenCodeReviewConfigSchema,
  findingStorePath: z.string().optional(),
  scannerSettings: ScannerSettingsSchema.optional(),
  mergePolicy: MergePolicySchema.optional(),
  webhook: WebhookConfigSchema.optional(),
  dashboard: DashboardConfigSchema.optional(),
  remediationTasks: RemediationTasksConfigSchema.optional(),
  audit: AuditConfigSchema.optional(),
  feedbackDaemon: FeedbackDaemonConfigSchema.optional(),
});

export type RootAgentConfig = z.infer<typeof RootAgentConfigSchema>;

export interface ConfigProvider {
  id: string;
  connect(): Promise<void>;
  getRootConfig(): Promise<RootAgentConfig>;
  resolveConfigPath(relativePath: string): string;
  getAdoClient(): AzureDevOps;
  getSonarQubeClient(): SonarQubeClient | null;
  getOrmClient(): Promise<NodePgDatabase<typeof schema> & { $client: Pool } | null>;
}
