import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import Handlebars from "handlebars";
import type { Pool } from "pg";
import { AzureDevOps } from "ratan-ado-api";
import type { schema } from "ratan-code-review-agent-orm";
import { SonarQubeClient } from "ratan-sonarqube-api";
import { v4 } from "uuid";
import z from "zod";
import { createOrmClient } from "./orm";
import {
  type AgentConfig,
  type AgentConfigCreationOptions,
  AgentConfigCreationOptionsSchema,
  type PromptContext,
  type RootAgentConfig,
  type Variables,
  VariablesSchema,
} from "./types";

const CONFIG_FILE = "config.json";
const REFRESH_INTERVAL_MS_DEFAULT = 5 * 60 * 1000; // 5 minutes

/**
 * AgentConfigClient is responsible for fetching, caching, and resolving agent configuration
 * and prompt files from Azure DevOps repositories.
 */
export class AgentConfigClient {
  public id: string;
  private adoClient: AzureDevOps;
  private sonarQubeClient: SonarQubeClient;
  private ormClient:
    | (NodePgDatabase<typeof schema> & {
        $client: Pool;
      })
    | null = null;
  private config: RootAgentConfig | null = null;
  private lastFetchTime: number = 0;
  private configCacheTTL: number; // Time to live in ms
  // Cache for raw markdown content: Path -> { content: string, timestamp: number }
  private fileCache: Map<string, { content: string; timestamp: number }> =
    new Map();

  /**
   * @param options Configuration options for ADO and caching
   */
  constructor(private options: AgentConfigCreationOptions) {
    const validOptions = z.parse(AgentConfigCreationOptionsSchema, options);
    // Set cache TTL from options or default to 5 minutes
    this.configCacheTTL =
      validOptions.refreshIntervalMs ?? REFRESH_INTERVAL_MS_DEFAULT;
    this.adoClient = new AzureDevOps({
      organization: validOptions.organization,
      project: validOptions.project,
    });
    this.sonarQubeClient = new SonarQubeClient();
    this.id = v4();
  }

  /**
   * Initializes the ADO client connection.
   */
  public async connect(): Promise<void> {
    console.log("[AgentConfigClient] Connecting to Azure DevOps...");
    await this.adoClient.connect(this.options.adoToken);
    console.log("[AgentConfigClient] Connected.");

    if (this.options.sonarQubeToken) {
      await this.sonarQubeClient.connect(this.options.sonarQubeToken);
    }

    if (this.options.ormConnectionUrl) {
      this.ormClient = createOrmClient(this.options.ormConnectionUrl);
      console.log("[AgentConfigClient] ORM instance created.");
    }
  }

  public getAdoClient() {
    return this.adoClient;
  }

  public getSonarQubeClient() {
    return this.sonarQubeClient;
  }

  public async getOrmClient() {
    return this.ormClient;
  }

  /**
   * Ensures config is loaded and fresh.
   * If stale, waits for the new fetch (Strict Hot Reload).
   */
  public async getRootConfig(): Promise<RootAgentConfig> {
    const isStale = Date.now() - this.lastFetchTime > this.configCacheTTL;
    if (!this.config || isStale) {
      console.log(
        `[AgentConfig] Config is ${
          !this.config ? "missing" : "stale"
        }. Fetching from ADO...`,
      );
      await this.refreshConfig();
    } else {
      console.log("[AgentConfig] Using cached config.");
    }
    return this.config!;
  }

  /**
   * Force fetch config.json from ADO and update cache.
   */
  public async refreshConfig(): Promise<void> {
    const path = this.resolvePath(CONFIG_FILE);
    console.log(`[AgentConfig] Fetching config from: ${path}`);
    const content = await this.fetchFile(path);
    try {
      this.config = JSON.parse(content);
      this.lastFetchTime = Date.now();
      console.log("[AgentConfig] Config loaded and cached.");
      // Optional: Clear file cache on config refresh to ensure consistency?
      // Or we can keep file cache independent. Let's keep them independent but subject to same TTL.
    } catch (e) {
      console.error("[AgentConfig] Failed to parse config.json:", e);
      throw new Error(`Failed to parse config.json: ${(e as Error).message}`);
    }
  }

  /**
   * Resolves the final configuration for a specific agent.
   * Merges Global Defaults -> Regex Matches (in order) -> Final Config
   * @param agentName Name of the agent to resolve config for
   */
  public async getAgentConfig(agentName: string): Promise<AgentConfig> {
    const fullConfig = await this.getRootConfig();
    // 1. Start with defaults
    const defaultConfig: AgentConfig = fullConfig.defaultAgentConfig || {};
    if (!fullConfig.agents[agentName]) {
      console.error(`[AgentConfig] Agent "${agentName}" not found in config.`);
      throw new Error(`Agent "${agentName}" not found in configuration.`);
    }

    // 2. Apply default config
    const resolvedConfig: AgentConfig = JSON.parse(
      JSON.stringify(fullConfig.agents[agentName]),
    );
    console.log(`[AgentConfig] Resolved config for agent "${agentName}".`);
    return {
      ...defaultConfig,
      ...resolvedConfig,
    };
  }

  /**
   * Constructs the final prompt string.
   * Handles: Config Resolution -> Path Interpolation -> File Fetching -> Content Interpolation
   * @param promptKey Key of the prompt/agent
   * @param context Variables for path/content interpolation
   */
  public async buildPrompt(
    promptKey: string,
    context?: PromptContext,
  ): Promise<string> {
    console.log(`[AgentConfig] Building prompt for key: ${promptKey}`);
    const agentConfig = await this.getAgentConfig(promptKey);
    const promptDefinition = agentConfig.prompts;
    if (!promptDefinition) {
      console.error(
        `[AgentConfig] Prompt key "${promptKey}" not found for agent.`,
      );
      throw new Error(
        `Prompt key "${promptKey}" not found for agent "${promptDefinition}"`,
      );
    }
    // Normalize definition to array (supports single string or string[])
    const filePathsTemplate = Array.isArray(promptDefinition)
      ? promptDefinition
      : [promptDefinition];
    const resolvedContents: string[] = [];
    for (const pathTemplate of filePathsTemplate) {
      // 1. Resolve Path Variables (e.g. prompts/{lang}/rule.md)
      const filePath = this.interpolate(pathTemplate, context?.pathVars);
      // 2. Fetch Content (with caching)
      const fullPath = this.resolvePath(filePath);
      const rawContent = await this.fetchCachedFile(fullPath);
      // 3. Resolve Content Variables (e.g. {{diff}})
      const finalContent = this.interpolate(rawContent, context?.contentVars);
      resolvedContents.push(finalContent);
      console.log(
        `[AgentConfig] Loaded and interpolated prompt file: ${fullPath}`,
      );
    }
    // Join multiple files with newlines
    return resolvedContents.join("\n\n");
  }

  // --- Helpers ---

  /**
   * Fetches a file from cache if fresh, otherwise fetches from ADO and caches it.
   * @param path File path to fetch
   */
  private async fetchCachedFile(path: string): Promise<string> {
    const now = Date.now();
    const cached = this.fileCache.get(path);
    if (cached && now - cached.timestamp < this.configCacheTTL) {
      console.log(`[AgentConfig] Using cached file: ${path}`);
      return cached.content;
    }
    console.log(`[AgentConfig] Fetching file from ADO: ${path}`);
    const content = await this.fetchFile(path);
    this.fileCache.set(path, { content, timestamp: now });
    return content;
  }

  /**
   * Fetches a file from Azure DevOps.
   * @param path File path to fetch
   */
  private async fetchFile(path: string): Promise<string> {
    try {
      const fileContent = await this.adoClient.getFileContent(
        this.options.repoName,
        path,
        this.options.branch,
      );
      if (fileContent.includes("GitItemNotFoundException")) {
        throw new Error(`File not found`);
      }
      console.log(
        `[AgentConfig] File fetched: ${path}, content: ${fileContent}`,
      );
      return fileContent;
    } catch (error: any) {
      const msg = error.message;
      console.error(`[AgentConfig] ADO Fetch Error (${path}): ${msg}`);
    }
  }

  /**
   * Interpolates variables into a Handlebars template string.
   * @param template Template string with Handlebars variables
   * @param variables Variables to interpolate
   */
  private interpolate(template: string, variables?: Variables): string {
    if (!variables) return template;
    const isValidVariables = VariablesSchema.safeParse(variables);
    if (!isValidVariables.success) {
      console.warn(
        `[AgentConfig] Invalid variables for interpolation: ${JSON.stringify(
          variables,
        )}`,
      );
      return template;
    }
    const compiled = Handlebars.compile(template);
    return compiled(variables);
  }

  /**
   * Resolves the full path for a file, joining basePath and file.
   * @param file File path (may be relative or absolute)
   */
  private resolvePath(file: string): string {
    const base = this.options.basePath || "";
    const cleanFile = file.startsWith("/") ? file.slice(1) : file;
    const cleanBase = base.endsWith("/") ? base.slice(0, -1) : base;
    const resolved = cleanBase ? `${cleanBase}/${cleanFile}` : cleanFile;
    // Log resolved path for traceability
    console.log(`[AgentConfig] Resolved path: ${resolved}`);
    return resolved;
  }
}

export const createAgentConfigClient = async (
  options: AgentConfigCreationOptions,
) => {
  const client = new AgentConfigClient(options);
  await client.connect();
  return client;
};
