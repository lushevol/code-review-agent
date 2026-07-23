import { beforeEach, describe, expect, it } from "vitest";
import { MemoryFindingStore } from "../../../../../../packages/finding-store/src/memory-store";
import type { NormalizedFinding } from "finding-store";
import { MetricsService } from "./metrics-service";

describe("MetricsService.computeMetrics", () => {
  let store: MemoryFindingStore;

  beforeEach(async () => {
    store = new MemoryFindingStore();
    await store.init();
  });

  it("classifies a resolved-by-commit finding as valid", () => {
    store.upsertFinding(finding({ id: "f1", resolvedByCommitHash: "abc123" }));
    const metrics = MetricsService.computeMetrics(store, 7, "repo", [], null);
    expect(metrics.validFindingCount).toBe(1);
    expect(metrics.falsePositiveCount).toBe(0);
    expect(metrics.pendingFeedbackCount).toBe(0);
    expect(metrics.validRate).toBe(1);
  });

  it("classifies waived/FP/accepted-risk findings as false-positive", () => {
    store.upsertFinding(finding({ id: "f1", resolution: "false-positive" }));
    store.upsertFinding(finding({ id: "f2", resolution: "waived" }));
    const metrics = MetricsService.computeMetrics(store, 7, "repo", [], null);
    expect(metrics.falsePositiveCount).toBe(2);
    expect(metrics.validFindingCount).toBe(0);
    expect(metrics.validRate).toBe(0);
  });

  it("counts open findings as pending", () => {
    store.upsertFinding(finding({ id: "f1", resolution: "open", resolvedByCommitHash: null }));
    const metrics = MetricsService.computeMetrics(store, 7, "repo", [], null);
    expect(metrics.pendingFeedbackCount).toBe(1);
    expect(metrics.validRate).toBeNull();
  });

  it("counts CVE findings from sonarqube-cve engine with severity breakdown", () => {
    const findings: NormalizedFinding[] = [
      finding({ id: "f1", sourceEngine: "sonarqube-cve", severity: "critical" }),
      finding({ id: "f2", sourceEngine: "sonarqube-cve", severity: "high" }),
    ];
    const metrics = MetricsService.computeMetrics(store, 7, "repo", findings, null);
    expect(metrics.cveFindings).toBe(2);
    expect(metrics.cveCritical).toBe(1);
  });

  it("detects coverage below threshold when measures show low line coverage", () => {
    const measures = {
      sonarQube: {
        coverage: {
          line: { current: 45, baseline: 80, delta: -35 },
          branch: { current: 30, baseline: 70, delta: -40 },
        },
      },
    };
    const metrics = MetricsService.computeMetrics(store, 7, "repo", [], measures);
    expect(metrics.coverageBelowThreshold).toBe(1);
    expect(metrics.hadCoverageData).toBe(1);
  });

  it("does not flag coverage issues when measures are null", () => {
    const metrics = MetricsService.computeMetrics(store, 7, "repo", [], null);
    expect(metrics.coverageBelowThreshold).toBe(0);
    expect(metrics.hadCoverageData).toBe(0);
  });

  it("computes resolution rate across all store findings for the PR", () => {
    store.upsertFinding(finding({ id: "r1", resolution: "resolved" }));
    store.upsertFinding(finding({ id: "r2", resolution: "open" }));
    store.upsertFinding(finding({ id: "r3", resolution: "open" }));
    const metrics = MetricsService.computeMetrics(store, 7, "repo", [], null);
    expect(metrics.resolvedFindings).toBe(1);
    expect(metrics.totalFindings).toBe(3);
    expect(metrics.resolutionRate).toBeCloseTo(1 / 3, 2);
  });

  it("computes valid rate correctly with mixed conclusive findings", () => {
    store.upsertFinding(finding({ id: "f1", resolvedByCommitHash: "abc" }));
    store.upsertFinding(finding({ id: "f2", resolution: "false-positive" }));
    store.upsertFinding(finding({ id: "f3", resolution: "open" })); // pending — excluded from rate
    const metrics = MetricsService.computeMetrics(store, 7, "repo", [], null);
    expect(metrics.validFindingCount).toBe(1);
    expect(metrics.falsePositiveCount).toBe(1);
    expect(metrics.pendingFeedbackCount).toBe(1);
    expect(metrics.validRate).toBe(0.5);
  });

  it("does not count superseded findings as resolved", () => {
    store.upsertFinding(finding({ id: "r1", resolution: "resolved" }));
    store.upsertFinding(finding({ id: "r2", resolution: "superseded" }));
    const metrics = MetricsService.computeMetrics(store, 7, "repo", [], null);
    expect(metrics.resolvedFindings).toBe(1);
    expect(metrics.totalFindings).toBe(2);
    expect(metrics.resolutionRate).toBeCloseTo(0.5, 2);
  });
});

function finding(overrides: Partial<NormalizedFinding> = {}): NormalizedFinding {
  return {
    id: crypto.randomUUID(),
    prId: 7,
    repository: "repo",
    filePath: "/src/file.ts",
    lineStart: 1,
    lineEnd: 1,
    category: "bug",
    severity: "high",
    title: "Test finding",
    description: "",
    evidence: "",
    businessImpact: "",
    remediation: "",
    blocking: false,
    linkedTaskId: null,
    resolution: "open",
    sourceEngine: "open-code-review",
    sourceVersion: "test",
    supersedesFindingId: null,
    contentHash: "hash",
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolvedByCommitHash: null,
    ...overrides,
  };
}
