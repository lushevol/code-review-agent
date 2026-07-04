import type { AzureDevOps } from "ratan-ado-api";
import type { SonarQubeClient } from "ratan-sonarqube-api";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { schema } from "ratan-code-review-agent-orm";
import { z } from "zod";

export const AgentConfigCreationOptionsSchema = z.object({
  adoToken: z.string(),
  sonarQubeToken: z.string().optional(),
  ormConnectionUrl: z.string().optional(),
  organization: z.string().optional(),
  project: z.string().optional(),
  adoProxyUrl: z.string().optional(),
  repoName: z.string(),
  branch: z.string(),
  basePath: z.string().optional(),
  refreshIntervalMs: z.number().optional(), // Default 5 mins
});

export type AgentConfigCreationOptions = z.infer<
  typeof AgentConfigCreationOptionsSchema
>;

/**
 * Agent config including agent settings and prompt paths.
 */
export const AgentConfigSchema = z.object({
  url: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().optional(),
  /**
   * Array of Path strings
   */
  prompts: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Array of prompt file paths"),
  evaluationTestcases: z
    .array(z.string())
    .optional()
    .describe("Array of dataset folder paths"),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

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

/**
 * Full agent config with defaults and optional repo-specific overrides.
 */
export const RootAgentConfigSchema = z.object({
  scanPRCreatedDaysAgo: z.number().optional(),
  scanRepoNames: z.array(z.string()).optional(),
  filePathsAllowlist: z.array(z.string()).optional(),
  filePathsBlocklist: z.array(z.string()).optional(),
  defaultAgentConfig: AgentConfigSchema.optional(),
  agents: z.record(z.string(), AgentConfigSchema),
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

export const VariablesSchema = z.record(z.string(), z.string());

export type Variables = z.infer<typeof VariablesSchema>;

/**
 * Context for resolving prompts and injecting variables.
 */
export const PromptContextSchema = z.object({
  /** Variables used to resolve file paths (e.g. { lang: 'ts' }) */
  pathVars: VariablesSchema.optional(),

  /** Variables injected into the markdown content (e.g. { code_diff: '...' }) */
  contentVars: VariablesSchema.optional(),
});

export type PromptContext = z.infer<typeof PromptContextSchema>;

export interface ConfigProvider {
  id: string;
  connect(): Promise<void>;
  getRootConfig(): Promise<RootAgentConfig>;
  getAgentConfig(agentName: string): Promise<AgentConfig>;
  buildPrompt(promptKey: string, context?: PromptContext): Promise<string>;
  getAdoClient(): AzureDevOps;
  getSonarQubeClient(): SonarQubeClient;
  getOrmClient(): Promise<NodePgDatabase<typeof schema> & { $client: Pool } | null>;
}
