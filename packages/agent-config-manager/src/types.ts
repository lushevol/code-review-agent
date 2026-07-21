import type { AzureDevOps } from "ratan-ado-api";
import type { SonarQubeClient } from "ratan-sonarqube-api";
import { z } from "zod";

const CveScannerSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  sonarqubeProjectKey: z.string().optional(),
});

const RetryConfigSchema = z.object({
  maxAttempts: z.number().int().min(1).max(10).optional(),
  baseDelayMs: z.number().int().min(0).optional(),
  maxDelayMs: z.number().int().min(0).optional(),
  jitterMs: z.number().int().min(0).optional(),
}).strict();

const LoggingConfigSchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]).optional(),
  directory: z.string().min(1).optional(),
  retentionDays: z.number().int().min(1).optional(),
  format: z.enum(["pretty", "json"]).optional(),
  console: z.boolean().optional(),
  file: z.boolean().optional(),
}).strict();

const SonarQubeConfigSchema = z.object({
  url: z.string().url(),
  token: z.string().min(1).optional(),
}).strict();

const ComplianceScannerSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  rulesPath: z.string().optional(),
  largeFileThreshold: z.number().int().min(50).optional(),
  consoleDetectionEnabled: z.boolean().optional(),
  todoDetectionEnabled: z.boolean().optional(),
});

const ScannerSettingsSchema = z.object({
  cve: CveScannerSettingsSchema.optional(),
  compliance: ComplianceScannerSettingsSchema.optional(),
  maxPrioritizedFindings: z.number().int().min(1).max(500).optional(),
  inlineCommentLimit: z.number().int().min(1).max(100).optional(),
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
  adoUrlTemplate: z.string().optional(),
  workItemTags: z.string().optional(),
});

const WorkspaceConfigSchema = z.object({
  maxGitOutputBytes: z.number().int().min(1048576).optional(),
  useSsh: z.boolean().optional(),
}).strict();

const SensitiveDataMaskCustomPatternSchema = z.object({
  pattern: z.string(),
  replaceWith: z.string(),
});

const SensitiveDataMaskConfigSchema = z.object({
  enabled: z.boolean().optional(),
  redactors: z.object({
    credentials: z.boolean().optional(),
  }).optional(),
  customPatterns: z.array(SensitiveDataMaskCustomPatternSchema).optional(),
}).strict();

const AuditConfigSchema = z.object({
  retentionDays: z.number().optional(),
});

const FeedbackDaemonConfigSchema = z.object({
  enabled: z.boolean().optional(),
  intervalMs: z.number().optional(),
});

const WatchConfigSchema = z.object({
  intervalMs: z.number().int().min(1_000).optional(),
}).strict();

const OpenCodeReviewLlmConfigSchema = z.object({
  url: z.string().url(),
  token: z.string().min(1),
  model: z.string().min(1),
  useAnthropic: z.boolean().optional(),
});

const OpenCodeReviewConfigSchema = z.object({
  workspaceRoot: z.string().optional(),
  rulesPath: z.string().min(1),
  llm: OpenCodeReviewLlmConfigSchema,
  concurrency: z.number().int().min(1).max(64).optional(),
  timeoutMs: z.number().int().min(30000).max(7200000).optional(),
});

/**
 * Full agent config with defaults and optional repo-specific overrides.
 */
export const RootAgentConfigSchema = z.object({
  scanPRCreatedDaysAgo: z.number().optional(),
  scanRepoNames: z.array(z.string()).optional(),
  openCodeReview: OpenCodeReviewConfigSchema,
  findingStorePath: z.string().optional(),
  logging: LoggingConfigSchema.optional(),
  retry: RetryConfigSchema.optional(),
  sonarQube: SonarQubeConfigSchema.optional(),
  scannerSettings: ScannerSettingsSchema.optional(),
  mergePolicy: MergePolicySchema.optional(),
  webhook: WebhookConfigSchema.optional(),
  dashboard: DashboardConfigSchema.optional(),
  remediationTasks: RemediationTasksConfigSchema.optional(),
  audit: AuditConfigSchema.optional(),
  workspace: WorkspaceConfigSchema.optional(),
  sensitiveDataMask: SensitiveDataMaskConfigSchema.optional(),
  feedbackDaemon: FeedbackDaemonConfigSchema.optional(),
  watch: WatchConfigSchema.optional(),
  ado: z.object({
    organization: z.string().min(1),
    project: z.string().min(1),
    token: z.string().optional(),
  }).optional(),
  adoProxyUrl: z.string().optional(),
  databaseUrl: z.string().optional(),
}).strict();

export type RootAgentConfig = z.infer<typeof RootAgentConfigSchema>;

export interface ConfigProvider {
  id: string;
  connect(): Promise<void>;
  getRootConfig(): Promise<RootAgentConfig>;
  resolveConfigPath(relativePath: string): string;
  getAdoClient(): AzureDevOps;
  getSonarQubeClient(): SonarQubeClient | null;
}
