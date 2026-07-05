import { Injectable, Logger } from "@nestjs/common";
import { AzureDevOps } from "ratan-ado-api";
import { SonarQubeClient } from "ratan-sonarqube-api";
// biome-ignore lint/style/useImportType: <explanation>
import { DrizzleService } from "src/drizzle/drizzle.service";

@Injectable()
export class OctAuthService {
  private adoToken = "";
  private adoTokenOwner = "";
  private sonarToken = "";
  private sonarTokenOwner = "";
  constructor(private readonly drizzleService: DrizzleService) {}

  private readonly logger = new Logger(OctAuthService.name, {
    timestamp: true,
  });

  async fetchAvailableAuth(): Promise<{
    adoToken: string;
    adoTokenOwner: string;
    sonarToken: string;
    sonarTokenOwner: string;
  }> {
    try {
      const auths =
        await this.drizzleService.workbenchAuthSearchAvailableAdoToken();
      if (auths?.length > 0) {
        this.logger.log(`Found ${auths.length} ADO auths`);
        for (const adoAuth of auths) {
          const adoClient = new AzureDevOps();
          try {
            const result = await adoClient.connect(adoAuth.adoToken);
            if (result.authenticatedUser) {
              this.adoToken = adoAuth.adoToken;
              this.adoTokenOwner = adoAuth.userId;
              break; // Valid token found
            } else {
              this.adoToken = "";
              this.adoTokenOwner = "";
            }
          } catch (error) {
            this.adoToken = "";
            this.adoTokenOwner = "";
          }
        }
      } else {
        this.logger.error("No ADO auths found");
        this.adoToken = "";
        this.adoTokenOwner = "";
      }

      const sonarAuths =
        await this.drizzleService.workbenchAuthSearchAvailableSonarToken();
      if (sonarAuths?.length > 0) {
        this.logger.log(`Found ${sonarAuths.length} Sonar auths`);
        for (const sonarAuth of sonarAuths) {
          const sonarClient = new SonarQubeClient();
          const result = await sonarClient.connect(sonarAuth.sonarToken);
          if (result) {
            this.sonarToken = sonarAuth.sonarToken;
            this.sonarTokenOwner = sonarAuth.userId;
            break; // Valid token found
          } else {
            this.sonarToken = "";
            this.sonarTokenOwner = "";
          }
        }
      } else {
        this.logger.error("No Sonar auths found");
        this.sonarToken = "";
        this.sonarTokenOwner = "";
      }

      return {
        adoToken: this.adoToken,
        adoTokenOwner: this.adoTokenOwner,
        sonarToken: this.sonarToken,
        sonarTokenOwner: this.sonarTokenOwner,
      };
    } catch (error) {
      this.logger.error("Error getting available auth:", error);
      return {
        adoToken: "",
        adoTokenOwner: "",
        sonarToken: "",
        sonarTokenOwner: "",
      };
    }
  }

  async getAvailableAuth(): Promise<{
    adoToken: string;
    adoTokenOwner: string;
    sonarToken: string;
    sonarTokenOwner: string;
  }> {
    if (!this.adoToken) {
      return this.fetchAvailableAuth();
    }
    return {
      adoToken: this.adoToken,
      adoTokenOwner: this.adoTokenOwner,
      sonarToken: this.sonarToken,
      sonarTokenOwner: this.sonarTokenOwner,
    };
  }
}
