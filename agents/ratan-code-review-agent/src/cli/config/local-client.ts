import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import Handlebars from "handlebars";
import { AzureDevOps } from "ratan-ado-api";
import { SonarQubeClient } from "ratan-sonarqube-api";
import type {
  AgentConfig,
  ConfigProvider,
  PromptContext,
  RootAgentConfig,
} from "agent-config-manager";

export interface LocalConfigOptions {
  configDir: string;
  config: RootAgentConfig;
  ado: { organization: string; project: string };
  adoToken?: string;
  adoProxyUrl?: string;
  sonarQubeToken?: string;
  /** Reserved for future ORM support. Not currently used. */
  databaseUrl?: string;
}

export class LocalConfigClient implements ConfigProvider {
  public id: string;
  private options: LocalConfigOptions;
  private adoClient: AzureDevOps | null = null;
  private sonarQubeClient: SonarQubeClient | null = null;

  constructor(options: LocalConfigOptions) {
    if (!options.configDir) {
      throw new Error("configDir is required");
    }
    if (!options.ado?.organization) {
      throw new Error("ado.organization is required");
    }
    if (!options.ado?.project) {
      throw new Error("ado.project is required");
    }
    this.options = options;
    this.id = randomUUID();
  }

  async connect(): Promise<void> {
    if (this.options.adoToken) {
      this.adoClient = new AzureDevOps({
        organization: this.options.ado.organization,
        project: this.options.ado.project,
        proxy: this.options.adoProxyUrl,
      });
      await this.adoClient.connect(this.options.adoToken);
    }
    if (this.options.sonarQubeToken) {
      this.sonarQubeClient = new SonarQubeClient();
      await this.sonarQubeClient.connect(this.options.sonarQubeToken);
    }
  }

  async getRootConfig(): Promise<RootAgentConfig> {
    return this.options.config;
  }

  async getAgentConfig(agentName: string): Promise<AgentConfig> {
    const fullConfig = await this.getRootConfig();
    const defaultConfig: AgentConfig = fullConfig.defaultAgentConfig || {};
    const agentConfig = fullConfig.agents[agentName];
    if (!agentConfig) {
      throw new Error(
        `Agent "${agentName}" not found in local configuration.`,
      );
    }
    return { ...defaultConfig, ...agentConfig };
  }

  async buildPrompt(
    promptKey: string,
    context?: PromptContext,
  ): Promise<string> {
    const agentConfig = await this.getAgentConfig(promptKey);
    const promptDefinition = agentConfig.prompts;
    if (!promptDefinition) {
      throw new Error(`Prompt key "${promptKey}" not found for agent.`);
    }

    const filePaths = Array.isArray(promptDefinition)
      ? promptDefinition
      : [promptDefinition];
    const resolvedContents: string[] = [];

    for (const pathTemplate of filePaths) {
      // Resolve path variables (e.g. prompts/{repo}/rule.md)
      const interpolatedPath = context?.pathVars
        ? Handlebars.compile(pathTemplate)(context.pathVars)
        : pathTemplate;

      const fullPath = path.resolve(
        this.options.configDir,
        interpolatedPath,
      );
      const rawContent = await readFile(fullPath, "utf-8");

      // Resolve content variables (e.g. {{diff}})
      const finalContent = context?.contentVars
        ? Handlebars.compile(rawContent)(context.contentVars)
        : rawContent;

      resolvedContents.push(finalContent);
    }
    return resolvedContents.join("\n\n");
  }

  getAdoClient(): AzureDevOps {
    if (!this.adoClient) {
      throw new Error("ADO client not connected. Call connect() first.");
    }
    return this.adoClient;
  }

  getSonarQubeClient(): SonarQubeClient {
    if (!this.sonarQubeClient) {
      throw new Error(
        "SonarQube client not connected. Call connect() first.",
      );
    }
    return this.sonarQubeClient;
  }

  async getOrmClient(): Promise<null> {
    return null;
  }
}
