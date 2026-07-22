/**
 * @see https://docs.sonarqube.org/latest/extend/web-api/#header-2
 */

import type { MeasuresComponent, ParsedMeasuresComponent } from "./interfaces";
import { getLogger } from "ratan-logger";

export interface SonarQubeClientOptions { url?: string; }

export interface SonarIssueSearchResult {
  total: number;
  p: number;
  ps: number;
  issues: SonarIssue[];
}

export interface SonarIssue {
  key: string;
  rule: string;
  severity: string;
  component: string;
  project: string;
  line: number;
  message: string;
  effort: string;
  debt: string;
  tags: string[];
  type: string;
  status: string;
  resolution: string;
  creationDate: string;
  updateDate: string;
  textRange?: {
    startLine: number;
    endLine: number;
    startOffset: number;
    endOffset: number;
  };
}

export class SonarQubeClient {
  private baseUrl: string;
  private authHeader: string | null = null;
  private logger = getLogger("sonarqube");

  // All SonarQube metric keys used for measures fetching.
  // Derived from the SonarMetricKey enum (sonarqube-webapis) minus
  // new_xxx_violations, xxx_violations, and branch_coverage_hits_data,
  // plus extra keys used by the deployment.
  private static readonly METRIC_KEYS = [
    // Custom / deployment-specific keys
    "conditions_to_cover",
    "new_software_quality_maintainability_rating",
    "new_software_quality_reliability_rating",
    "new_software_quality_security_rating",
    "software_quality_maintainability_issues",
    "software_quality_maintainability_rating",
    "software_quality_reliability_issues",
    "software_quality_reliability_rating",
    "software_quality_security_issues",
    "software_quality_security_rating",

    // SonarMetricKey values (minus excluded ones)
    "complexity",
    "cognitive_complexity",
    "duplicated_blocks",
    "duplicated_files",
    "duplicated_lines",
    "duplicated_lines_density",
    "new_violations",
    "violations",
    "false_positive_issues",
    "open_issues",
    "confirmed_issues",
    "reopened_issues",
    "code_smells",
    "new_code_smells",
    "sqale_rating",
    "sqale_index",
    "new_technical_debt",
    "sqale_debt_ratio",
    "new_sqale_debt_ratio",
    "alert_status",
    "quality_gate_details",
    "bugs",
    "new_bugs",
    "reliability_rating",
    "reliability_remediation_effort",
    "new_reliability_remediation_effort",
    "vulnerabilities",
    "new_vulnerabilities",
    "security_rating",
    "security_remediation_effort",
    "new_security_remediation_effort",
    "security_hotspots",
    "new_security_hotspots",
    "security_review_rating",
    "new_security_review_rating",
    "security_hotspots_reviewed",
    "classes",
    "comment_lines",
    "comment_lines_density",
    "directories",
    "files",
    "lines",
    "ncloc",
    "ncloc_language_distribution",
    "functions",
    "projects",
    "statements",
    "branch_coverage",
    "new_branch_coverage",
    "conditions_by_line",
    "covered_conditions_by_line",
    "coverage",
    "new_coverage",
    "line_coverage",
    "new_line_coverage",
    "coverage_line_hits_data",
    "lines_to_cover",
    "new_lines_to_cover",
    "skipped_tests",
    "uncovered_conditions",
    "new_uncovered_conditions",
    "uncovered_lines",
    "new_uncovered_lines",
    "tests",
    "test_execution_time",
    "test_errors",
    "test_failures",
    "test_success_density",
  ];

  constructor(private readonly options: SonarQubeClientOptions = {}) {
    this.baseUrl = options.url ?? "https://sonarqube.vx.standardchartered.com/api";
  }

  // response indicates whether login is successful or not.
  public async connect(token: string): Promise<boolean> {
    if (!token) {
      this.logger.error("SonarQube token is required.");
      return false;
    }
    try {
      const encoded = Buffer.from(`${token}:`).toString("base64");
      const response = await fetch(`${this.baseUrl}/authentication/validate`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${encoded}`,
        },
      });
      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error("SonarQube login failed", { status: response.status, body: errorBody });
        return false;
      }
      const data = (await response.json()) as { valid: boolean };
      if (data.valid) {
        this.authHeader = `Basic ${encoded}`;
        this.logger.info("SonarQube login succeeded");
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error("SonarQube login failed", error);
      return false;
    }
  }

  public async searchIssues(
    projectKey: string,
    params: {
      types?: string;
      severities?: string;
      statuses?: string;
      p?: number;
      ps?: number;
      pullRequest?: number;
      branch?: string;
      resolutions?: string;
    } = {},
  ): Promise<SonarIssueSearchResult> {
    try {
      const url = new URL(`${this.baseUrl}/issues/search`);
      url.searchParams.set("componentKeys", projectKey);
      url.searchParams.set("additionalFields", "_all");
      if (params.types) url.searchParams.set("types", params.types);
      if (params.severities) url.searchParams.set("severities", params.severities);
      if (params.statuses) url.searchParams.set("statuses", params.statuses);
      if (params.pullRequest !== undefined) url.searchParams.set("pullRequest", String(params.pullRequest));
      if (params.branch) url.searchParams.set("branch", params.branch);
      if (params.resolutions) url.searchParams.set("resolutions", params.resolutions);
      url.searchParams.set("p", String(params.p ?? 1));
      url.searchParams.set("ps", String(params.ps ?? 100));

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: this.authHeader!,
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`SonarQube issue search failed (${response.status}): ${errorBody}`);
      }

      const data = await response.json();
      return this.parseIssuesResponse(data);
    } catch (error) {
      this.logger.error("Error searching SonarQube issues", error);
      throw error;
    }
  }

  private parseIssuesResponse(data: unknown): SonarIssueSearchResult {
    const d = data as Record<string, unknown>;
    return {
      total: Number(d.total ?? 0),
      p: Number(d.p ?? 1),
      ps: Number(d.ps ?? 100),
      issues: ((d.issues as Record<string, unknown>[]) ?? []).map((issue) => ({
        key: String(issue.key ?? ""),
        rule: String(issue.rule ?? ""),
        severity: String(issue.severity ?? ""),
        component: String(issue.component ?? ""),
        project: String(issue.project ?? ""),
        line: Number(issue.line ?? 0),
        message: String(issue.message ?? ""),
        effort: String(issue.effort ?? ""),
        debt: String(issue.debt ?? ""),
        tags: (issue.tags as string[]) ?? [],
        type: String(issue.type ?? ""),
        status: String(issue.status ?? ""),
        resolution: String(issue.resolution ?? ""),
        creationDate: String(issue.creationDate ?? ""),
        updateDate: String(issue.updateDate ?? ""),
        textRange: issue.textRange
          ? {
              startLine: Number(
                (issue.textRange as Record<string, unknown>).startLine ?? 0,
              ),
              endLine: Number(
                (issue.textRange as Record<string, unknown>).endLine ?? 0,
              ),
              startOffset: Number(
                (issue.textRange as Record<string, unknown>).startOffset ?? 0,
              ),
              endOffset: Number(
                (issue.textRange as Record<string, unknown>).endOffset ?? 0,
              ),
            }
          : undefined,
      })),
    };
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

      const url = new URL(`${this.baseUrl}/measures/component`);
      url.searchParams.set("component", repoName);
      url.searchParams.set("metricKeys", SonarQubeClient.METRIC_KEYS.join(","));
      url.searchParams.set("additionalFields", "metrics");
      if (prId !== undefined) {
        url.searchParams.set("pullRequest", String(prId));
      } else if (branch !== undefined) {
        url.searchParams.set("branch", branch);
      }

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: this.authHeader!,
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`SonarQube measures fetch failed (${response.status}): ${errorBody}`);
      }

      const data = (await response.json()) as MeasuresComponent;

      const result = data.component.measures.reduce(
        (acc: Record<string, unknown>, measure) => {
          acc[measure.metric] = Number(measure.value ?? measure.period.value);
          return acc;
        },
        {} as ParsedMeasuresComponent,
      ) as ParsedMeasuresComponent;

      return result;
    } catch (error) {
      this.logger.error("Error fetching SonarQube measures", error);
      throw error;
    }
  }
}
