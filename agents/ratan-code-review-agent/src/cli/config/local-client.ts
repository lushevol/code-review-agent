import { randomUUID } from "node:crypto";
import path from "node:path";
import { AzureDevOps } from "ratan-ado-api";
import { SonarQubeClient } from "ratan-sonarqube-api";
import type {
  ConfigProvider,
  RootAgentConfig,
} from "agent-config-manager";
import { getLogger } from "ratan-logger";

export interface LocalConfigOptions {
  configDir: string;
  config: RootAgentConfig;
  ado: { organization: string; project: string };
  adoToken?: string;
  adoProxyUrl?: string;
  /** Reserved for future ORM support. Not currently used. */
  databaseUrl?: string;
}

export class LocalConfigClient implements ConfigProvider {
  public id: string;
  private options: LocalConfigOptions;
  private adoClient: AzureDevOps | null = null;
  private sonarQubeClient: SonarQubeClient | null = null;
  private logger = getLogger("config");

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
    const sonarConfig = this.options.config.sonarQube;
    if (sonarConfig?.token) {
      const sonarClient = new SonarQubeClient({ url: sonarConfig.url });
      if (await sonarClient.connect(sonarConfig.token)) {
        this.sonarQubeClient = sonarClient;
      } else {
        this.logger.warn("SonarQube connection unavailable; skipping Sonar validation.");
      }
    }
  }

  async getRootConfig(): Promise<RootAgentConfig> {
    return this.options.config;
  }

  resolveConfigPath(relativePath: string): string {
    return path.resolve(this.options.configDir, relativePath);
  }

  getAdoClient(): AzureDevOps {
    if (!this.adoClient) {
      throw new Error("ADO client not connected. Call connect() first.");
    }
    return this.adoClient;
  }

  getSonarQubeClient(): SonarQubeClient | null {
    return this.sonarQubeClient;
  }

}
