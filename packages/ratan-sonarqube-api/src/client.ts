/**
 * @see https://docs.sonarqube.org/latest/extend/web-api/#header-2
 */

import type { AxiosError, AxiosResponse } from "axios";
import Sonar from "sonarqube-webapis";
import { SonarMetricKey } from "sonarqube-webapis/dist/src/enums.js";
import { MeasuresAdditionalFields } from "sonarqube-webapis/dist/src/resources/index.js";
import type { MeasuresComponent, ParsedMeasuresComponent } from "./interfaces";

export class SonarQubeClient {
  private sonar!: Sonar;

  // response indecate whether login is successful or not.
  public async connect(token: string): Promise<boolean> {
    if (!token) {
      console.error("SonarQube token is required.");
      return false;
    }
    let SonarClass = Sonar;
    if ("default" in Sonar) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      SonarClass = (Sonar as any).default;
    }
    this.sonar = new SonarClass({
      // 1. User token: set your token in the username, set empty string password.
      // 2. Basic access: set your standard login username & password.
      auth: {
        username: token,
        password: "",
      },
      // You can use sonarcloud / sonarqube web api url.
      baseURL: "https://sonarqube.vx.standardchartered.com/api",
    });
    try {
      // {@link https://sonarcloud.io/web_api/api/authentication/validate}
      const result = await this.sonar.authentication.validate();
      if (result.data.valid) {
        console.log("\n\nSonarQube Login Successfully\n\n");
        return true;
      }
      return false;
    } catch (error) {
      // This is to show error messages from sonar.
      console.error("Errors: ", (error as AxiosError).response?.data);
      return false;
    }
  }

  public async getMeasures(
    prIdOrBranch: number | string,
    repoName: string,
  ): Promise<ParsedMeasuresComponent> {
    try {
      const prId = typeof prIdOrBranch === "number" ? prIdOrBranch : undefined;
      const branch =
        typeof prIdOrBranch === "string" ? prIdOrBranch : undefined;

      if (!(prId || branch)) {
        return {
          coverage: "-",
          line_coverage: "-",
          new_bugs: "-",
          new_vulnerabilities: "-",
          new_code_smells: "-",
          new_coverage: "-",
        } as unknown as ParsedMeasuresComponent;
      }
      const resp = (await this.sonar.measures.component(
        repoName,
        Array.from(
          new Set([
            "conditions_to_cover",
            // "accepted_issues",
            // "alert_status",
            // "bugs",
            // "code_smells",
            // "coverage",
            // "duplicated_blocks",
            // "duplicated_lines_density",
            // "high_impact_accepted_issues",
            // "lines",
            // "lines_to_cover",
            // "ncloc",
            // "ncloc_language_distribution",
            // "new_accepted_issues",
            // "new_bugs",
            // "new_code_smells",
            // "new_coverage",
            // "new_duplicated_lines_density",
            // "new_lines",
            // "new_lines_to_cover",
            // "new_maintainability_rating",
            // "new_reliability_rating",
            // "new_security_hotspots",
            // "new_security_hotspots_reviewed",
            // "new_security_rating",
            // "new_security_review_rating",
            "new_software_quality_maintainability_rating",
            "new_software_quality_reliability_rating",
            "new_software_quality_security_rating",
            // "new_technical_debt",
            // "new_violations",
            // "new_vulnerabilities",
            // "projects",
            // "quality_gate_details",
            // "reliability_rating",
            // "security_hotspots",
            // "security_hotspots_reviewed",
            // "security_rating",
            // "security_review_rating",
            "software_quality_maintainability_issues",
            "software_quality_maintainability_rating",
            "software_quality_reliability_issues",
            "software_quality_reliability_rating",
            "software_quality_security_issues",
            "software_quality_security_rating",
            // "sqale_index",
            // "sqale_rating",
            // "tests",
            // "violations",
            // "vulnerabilities",
            ...(Object.values(SonarMetricKey) as Array<SonarMetricKey>).filter(
              (key) => {
                return ![
                  SonarMetricKey.newXXXViolations,
                  SonarMetricKey.xxxViolations,
                  SonarMetricKey.branchCoverageHitsData,
                ].includes(key);
              },
            ),
          ]),
        ) as SonarMetricKey[],
        [MeasuresAdditionalFields.metrics],
        branch,
        prId,
      )) as AxiosResponse<MeasuresComponent>;

      const result = resp.data.component.measures.reduce((acc: Record<string, unknown>, measure) => {
        acc[measure.metric] = Number(measure.value ?? measure.period.value);
        return acc;
      }, {} as ParsedMeasuresComponent) as ParsedMeasuresComponent;

      return result;
    } catch (error) {
      console.error("Error fetching measures: ", (error as AxiosError).message);
      throw error;
    }
  }
}
