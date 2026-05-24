import { z } from "zod";

export const AgentConfigCreationOptionsSchema = z.object({
  adoToken: z.string(),
  sonarQubeToken: z.string().optional(),
  ormConnectionUrl: z.string().optional(),
  organization: z.string().optional(),
  project: z.string().optional(),
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
