import { randomUUID } from "node:crypto";
import type { FindingStore, NormalizedFinding, ReviewMetrics } from "finding-store";

const COVERAGE_THRESHOLD = 50; // minimum acceptable line coverage percentage

export class MetricsService {
  /**
   * Compute review metrics from findings and SonarQube measures.
   * This is a pure computation -- it reads from the store to get all
   * findings for the PR (across all time), but does not write.
   *
   * @param store -- FindingStore (used read-only to fetch all PR findings)
   * @param prId -- pull request ID
   * @param repository -- repository name
   * @param findings -- the current batch of findings from this review
   * @param measures -- SonarQube measures (or null)
   */
  static computeMetrics(
    store: Pick<FindingStore, "getFindingsByPr">,
    prId: number,
    repository: string,
    findings: NormalizedFinding[],
    measures: unknown,
  ): ReviewMetrics {
    const allPrFindings = store.getFindingsByPr(prId, repository);

    // -- Valid / false-positive classification (current batch) --
    let validCount = 0;
    let falsePositiveCount = 0;
    let pendingCount = 0;

    for (const f of findings) {
      if (f.resolvedByCommitHash || f.resolution === "resolved") {
        validCount++;
      } else if (
        f.resolution === "false-positive" ||
        f.resolution === "waived" ||
        f.resolution === "accepted-risk"
      ) {
        falsePositiveCount++;
      } else {
        pendingCount++;
      }
    }

    const totalClassified = validCount + falsePositiveCount;
    const validRate = totalClassified > 0 ? validCount / totalClassified : null;

    // -- CVE count --
    const cveFindings = findings.filter(
      (f) => f.sourceEngine === "sonarqube-cve",
    );
    const cveCritical = cveFindings.filter(
      (f) => f.severity === "critical",
    ).length;

    // -- Coverage issues --
    const m = measures as Record<string, unknown> | null;
    const sq = (m?.sonarQube as Record<string, unknown> | undefined) ?? null;
    const coverage = (sq?.coverage as Record<string, unknown> | undefined) ?? null;
    const lineCov = coverage?.line as Record<string, unknown> | undefined;
    const currentLineCoverage =
      lineCov && typeof lineCov.current === "number"
        ? (lineCov.current as number)
        : null;

    const hadCoverageData = currentLineCoverage !== null ? 1 : 0;
    const coverageBelowThreshold =
      currentLineCoverage !== null && currentLineCoverage < COVERAGE_THRESHOLD
        ? 1
        : 0;

    // -- Resolution rate (across all time for this PR) --
    const resolvedFindings = allPrFindings.filter(
      (f) => f.resolution === "resolved",
    ).length;
    const totalFindings = allPrFindings.length;
    const resolutionRate =
      totalFindings > 0 ? resolvedFindings / totalFindings : null;

    return {
      id: randomUUID(),
      prId,
      repository,
      auditRecordId: null,
      totalFindings,
      resolvedFindings,
      validFindingCount: validCount,
      falsePositiveCount,
      pendingFeedbackCount: pendingCount,
      cveFindings: cveFindings.length,
      cveCritical,
      coverageBelowThreshold,
      hadCoverageData,
      resolutionRate,
      validRate,
      computedAt: new Date().toISOString(),
    };
  }
}
