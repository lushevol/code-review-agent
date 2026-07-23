# Review Performance Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track code review effectiveness metrics per-PR-revisit (valid/FP rate, CVE detection, coverage issues, resolution rate) stored in SQLite and displayed on the dashboard.

**Architecture:** Add a `review_metrics` SQLite table to finding-store, compute metrics in a new workflow step after `sonarqubeMeasures`, serve via a new `/api/metrics` Hono endpoint, and render as summary cards + trend charts in the existing React dashboard.

**Tech Stack:** sql.js (SQLite), Hono, Recharts, TypeScript, Zod

---

## File Structure

| File | Responsibility |
|------|---------------|
| `packages/finding-store/src/index.ts` | DDL for `review_metrics` table; `ReviewMetrics` type; `saveMetrics()`, `queryMetrics()`, `queryAggregatedMetrics()` methods |
| `packages/finding-store/src/memory-store.ts` | `saveMetrics()`, `queryMetrics()`, `queryAggregatedMetrics()` memory impl |
| `agents/ratan-code-review-agent/src/review/workflows/services/metrics-service.ts` | `computeMetrics()` — pure classification and aggregation logic |
| `agents/ratan-code-review-agent/src/review/workflows/services/metrics-service.spec.ts` | Tests for MetricsService |
| `agents/ratan-code-review-agent/src/review/workflows/steps/record-metrics.ts` | Workflow step: instantiate store, call service, persist, flush |
| `agents/ratan-code-review-agent/src/review/workflows/pr-review-workflow.ts` | Wire `recordMetrics` step after `sonarqubeMeasures` |
| `agents/ratan-code-review-agent/src/cli/dashboard/index.ts` | `GET /api/metrics` route — aggregate and per-PR queries |
| `agents/ratan-code-review-agent/src/cli/dashboard/index.spec.ts` | Add test for `/api/metrics` endpoint |
| `agents/ratan-code-review-agent/dashboard/src/api.ts` | `fetchMetrics()` frontend API function |
| `agents/ratan-code-review-agent/dashboard/src/pages/DashboardOverview.tsx` | New summary cards + "Performance Trends" section with 3 Recharts |

---

### Task 1: Add review_metrics table, types, and store methods to finding-store

**Files:**
- Modify: `packages/finding-store/src/index.ts`
- Modify: `packages/finding-store/src/memory-store.ts`

- [ ] **Step 1: Add ReviewMetrics interface and ReviewMetricsRow type to index.ts**

Insert after the `FindingCommentThread` interface (line 85):

```ts
export interface ReviewMetrics {
  id: string;
  prId: number;
  repository: string;
  auditRecordId: string | null;
  totalFindings: number;
  resolvedFindings: number;
  validFindingCount: number;
  falsePositiveCount: number;
  pendingFeedbackCount: number;
  cveFindings: number;
  cveCritical: number;
  coverageBelowThreshold: number;
  hadCoverageData: number;
  resolutionRate: number | null;
  validRate: number | null;
  computedAt: string;
}
```

Insert after the `FindingCommentThreadRow` interface (line 152):

```ts
interface ReviewMetricsRow {
  id: string;
  pr_id: number;
  repository: string;
  audit_record_id: string | null;
  total_findings: number;
  resolved_findings: number;
  valid_finding_count: number;
  false_positive_count: number;
  pending_feedback_count: number;
  cve_findings: number;
  cve_critical: number;
  coverage_below_threshold: number;
  had_coverage_data: number;
  resolution_rate: number | null;
  valid_rate: number | null;
  computed_at: string;
}
```

- [ ] **Step 2: Add statement ID constants**

Add to the `STMT` const (around line 168):

```ts
  SAVE_METRICS: "stmt:saveMetrics",
  QUERY_METRICS: "stmt:queryMetrics",
  QUERY_AGGREGATED_METRICS: "stmt:queryAggregatedMetrics",
```

- [ ] **Step 3: Add DDL for review_metrics table in runDDL()**

Inside the `this.db!.run(`` ` `` ... `` ` ``)` call in `runDDL()`, after the `finding_comment_threads` CREATE TABLE (after line 335):

```ts
      CREATE TABLE IF NOT EXISTS review_metrics (
        id TEXT PRIMARY KEY,
        pr_id INTEGER NOT NULL,
        repository TEXT NOT NULL,
        audit_record_id TEXT,
        total_findings INTEGER NOT NULL DEFAULT 0,
        resolved_findings INTEGER NOT NULL DEFAULT 0,
        valid_finding_count INTEGER NOT NULL DEFAULT 0,
        false_positive_count INTEGER NOT NULL DEFAULT 0,
        pending_feedback_count INTEGER NOT NULL DEFAULT 0,
        cve_findings INTEGER NOT NULL DEFAULT 0,
        cve_critical INTEGER NOT NULL DEFAULT 0,
        coverage_below_threshold INTEGER NOT NULL DEFAULT 0,
        had_coverage_data INTEGER NOT NULL DEFAULT 0,
        resolution_rate REAL,
        valid_rate REAL,
        computed_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_review_metrics_pr ON review_metrics(pr_id, repository);
```

- [ ] **Step 4: Add SQL strings in storeSQLs()**

After `GET_FINDING_COMMENT_THREADS_BY_PR` insert (line 415), add:

```ts
    this.sqls.set(
      STMT.SAVE_METRICS,
      `INSERT INTO review_metrics
        (id, pr_id, repository, audit_record_id,
         total_findings, resolved_findings,
         valid_finding_count, false_positive_count, pending_feedback_count,
         cve_findings, cve_critical,
         coverage_below_threshold, had_coverage_data,
         resolution_rate, valid_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.sqls.set(
      STMT.QUERY_METRICS,
      "SELECT * FROM review_metrics WHERE pr_id = ? AND repository = ? ORDER BY computed_at DESC",
    );
    this.sqls.set(
      STMT.QUERY_AGGREGATED_METRICS,
      `SELECT
        COUNT(*) as total_reviews,
        AVG(valid_rate) as avg_valid_rate,
        AVG(resolution_rate) as avg_resolution_rate,
        SUM(cve_findings) as total_cve,
        SUM(coverage_below_threshold) as total_coverage_issues,
        COUNT(CASE WHEN cve_findings > 0 THEN 1 END) as reviews_with_cve
       FROM review_metrics
       WHERE valid_rate IS NOT NULL`,
    );
```

- [ ] **Step 5: Add saveMetrics() public method**

After `queryOverrideLog()` (around line 658), add:

```ts
  /**
   * Persist a computed review-metrics record.
   */
  saveMetrics(metrics: ReviewMetrics): void {
    this.assertInitialized();
    try {
      exec(this.prep(STMT.SAVE_METRICS), [
        metrics.id,
        metrics.prId,
        metrics.repository,
        metrics.auditRecordId,
        metrics.totalFindings,
        metrics.resolvedFindings,
        metrics.validFindingCount,
        metrics.falsePositiveCount,
        metrics.pendingFeedbackCount,
        metrics.cveFindings,
        metrics.cveCritical,
        metrics.coverageBelowThreshold,
        metrics.hadCoverageData,
        metrics.resolutionRate,
        metrics.validRate,
      ]);
    } catch (err) {
      throw new Error(
        `Failed to save metrics: ${(err as Error).message}`,
      );
    }
  }
```

- [ ] **Step 6: Add queryMetrics() and queryAggregatedMetrics() public methods**

After `saveMetrics()`, add:

```ts
  /**
   * Get review metrics for a specific PR, ordered by computedAt descending.
   */
  queryMetrics(prId: number, repository: string): ReviewMetrics[] {
    this.assertInitialized();
    try {
      const resultRows = rows<ReviewMetricsRow>(
        this.prep(STMT.QUERY_METRICS),
        [prId, repository],
      );
      return resultRows.map(rowToReviewMetrics);
    } catch (err) {
      throw new Error(
        `Failed to query metrics for PR ${prId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Get aggregate metrics across all review metrics records.
   */
  queryAggregatedMetrics(): {
    totalReviews: number;
    averageValidRate: number | null;
    averageResolutionRate: number | null;
    totalCveDetected: number;
    totalCoverageIssues: number;
    reviewsWithCve: number;
  } {
    this.assertInitialized();
    try {
      const result = row<{
        total_reviews: number;
        avg_valid_rate: number | null;
        avg_resolution_rate: number | null;
        total_cve: number;
        total_coverage_issues: number;
        reviews_with_cve: number;
      }>(this.prep(STMT.QUERY_AGGREGATED_METRICS));
      return {
        totalReviews: result?.total_reviews ?? 0,
        averageValidRate: result?.avg_valid_rate ?? null,
        averageResolutionRate: result?.avg_resolution_rate ?? null,
        totalCveDetected: result?.total_cve ?? 0,
        totalCoverageIssues: result?.total_coverage_issues ?? 0,
        reviewsWithCve: result?.reviews_with_cve ?? 0,
      };
    } catch (err) {
      throw new Error(
        `Failed to query aggregated metrics: ${(err as Error).message}`,
      );
    }
  }
```

- [ ] **Step 7: Add rowToReviewMetrics mapping function**

After `rowToAuditRecord()` (around line 898), add:

```ts
function rowToReviewMetrics(r: ReviewMetricsRow): ReviewMetrics {
  return {
    id: r.id,
    prId: r.pr_id,
    repository: r.repository,
    auditRecordId: r.audit_record_id,
    totalFindings: r.total_findings,
    resolvedFindings: r.resolved_findings,
    validFindingCount: r.valid_finding_count,
    falsePositiveCount: r.false_positive_count,
    pendingFeedbackCount: r.pending_feedback_count,
    cveFindings: r.cve_findings,
    cveCritical: r.cve_critical,
    coverageBelowThreshold: r.coverage_below_threshold,
    hadCoverageData: r.had_coverage_data,
    resolutionRate: r.resolution_rate,
    validRate: r.valid_rate,
    computedAt: r.computed_at,
  };
}
```

- [ ] **Step 8: Add matching methods to MemoryFindingStore**

In `packages/finding-store/src/memory-store.ts`:
1. Add `ReviewMetrics` to the existing import from `"./index"`:

```ts
import type {
  AuditRecord,
  FindingEngine,
  FindingCommentThread,
  FindingResolution,
  NormalizedFinding,
  ReviewMetrics,
} from "./index";
```

2. Add `metricsRecords` array and methods inside the class:

```ts
  private metricsRecords: ReviewMetrics[] = [];

  saveMetrics(metrics: ReviewMetrics): void {
    this.metricsRecords.push(metrics);
  }

  queryMetrics(prId: number, repository: string): ReviewMetrics[] {
    return this.metricsRecords
      .filter((m) => m.prId === prId && m.repository === repository)
      .sort((a, b) => b.computedAt.localeCompare(a.computedAt));
  }

  queryAggregatedMetrics(): {
    totalReviews: number;
    averageValidRate: number | null;
    averageResolutionRate: number | null;
    totalCveDetected: number;
    totalCoverageIssues: number;
    reviewsWithCve: number;
  } {
    const withValidRate = this.metricsRecords.filter((m) => m.validRate !== null);
    const totalReviews = withValidRate.length;
    if (totalReviews === 0) {
      return {
        totalReviews: 0,
        averageValidRate: null,
        averageResolutionRate: null,
        totalCveDetected: 0,
        totalCoverageIssues: 0,
        reviewsWithCve: 0,
      };
    }
    return {
      totalReviews,
      averageValidRate: withValidRate.reduce((s, m) => s + (m.validRate ?? 0), 0) / totalReviews,
      averageResolutionRate: withValidRate.reduce((s, m) => s + (m.resolutionRate ?? 0), 0) / totalReviews,
      totalCveDetected: this.metricsRecords.reduce((s, m) => s + m.cveFindings, 0),
      totalCoverageIssues: this.metricsRecords.reduce((s, m) => s + m.coverageBelowThreshold, 0),
      reviewsWithCve: this.metricsRecords.filter((m) => m.cveFindings > 0).length,
    };
  }
```

3. In the `close()` method, add `this.metricsRecords = [];`.

- [ ] **Step 9: Commit**

```bash
git add packages/finding-store/src/index.ts packages/finding-store/src/memory-store.ts
git commit -m "feat(finding-store): add review_metrics table, types, save/query methods"
```

---

### Task 2: Create MetricsService with computation logic

**Files:**
- Create: `agents/ratan-code-review-agent/src/review/workflows/services/metrics-service.ts`
- Test: `agents/ratan-code-review-agent/src/review/workflows/services/metrics-service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `agents/ratan-code-review-agent/src/review/workflows/services/metrics-service.spec.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryFindingStore } from "../../../../../../../packages/finding-store/src/memory-store";
import type { NormalizedFinding } from "finding-store";
import { MetricsService } from "./metrics-service";

describe("MetricsService.computeMetrics", () => {
  let store: MemoryFindingStore;

  beforeEach(async () => {
    store = new MemoryFindingStore();
    await store.init();
  });

  it("classifies a resolved-by-commit finding as valid", () => {
    const findings: NormalizedFinding[] = [
      finding({ id: "f1", resolvedByCommitHash: "abc123" }),
    ];
    const metrics = MetricsService.computeMetrics(store, 7, "repo", findings, null);
    expect(metrics.validFindingCount).toBe(1);
    expect(metrics.falsePositiveCount).toBe(0);
    expect(metrics.pendingFeedbackCount).toBe(0);
    expect(metrics.validRate).toBe(1);
  });

  it("classifies waived/FP/accepted-risk findings as false-positive", () => {
    const findings: NormalizedFinding[] = [
      finding({ id: "f1", resolution: "false-positive" }),
      finding({ id: "f2", resolution: "waived" }),
    ];
    const metrics = MetricsService.computeMetrics(store, 7, "repo", findings, null);
    expect(metrics.falsePositiveCount).toBe(2);
    expect(metrics.validFindingCount).toBe(0);
    expect(metrics.validRate).toBe(0);
  });

  it("counts open findings as pending", () => {
    const findings: NormalizedFinding[] = [
      finding({ id: "f1", resolution: "open", resolvedByCommitHash: null }),
    ];
    const metrics = MetricsService.computeMetrics(store, 7, "repo", findings, null);
    expect(metrics.pendingFeedbackCount).toBe(1);
    expect(metrics.validRate).toBeNull();
  });

  it("counts CVE findings from sonarqube-cve engine with severity breakdown", () => {
    const findings: NormalizedFinding[] = [
      finding({
        id: "f1",
        sourceEngine: "sonarqube-cve",
        severity: "critical",
      }),
      finding({
        id: "f2",
        sourceEngine: "sonarqube-cve",
        severity: "high",
      }),
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
    const findings: NormalizedFinding[] = [
      finding({ id: "f1", resolvedByCommitHash: "abc" }),
      finding({ id: "f2", resolution: "false-positive" }),
      finding({ id: "f3", resolution: "open" }), // pending — excluded from rate
    ];
    const metrics = MetricsService.computeMetrics(store, 7, "repo", findings, null);
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
```

Run: `npx vitest run agents/ratan-code-review-agent/src/review/workflows/services/metrics-service.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 2: Write the MetricsService**

Create `agents/ratan-code-review-agent/src/review/workflows/services/metrics-service.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { FindingStore, NormalizedFinding, ReviewMetrics } from "finding-store";

const COVERAGE_THRESHOLD = 50; // minimum acceptable line coverage percentage

export class MetricsService {
  /**
   * Compute review metrics from findings and SonarQube measures.
   * This is a pure computation — it reads from the store to get all
   * findings for the PR (across all time), but does not write.
   *
   * @param store — FindingStore (used read-only to fetch all PR findings)
   * @param prId — pull request ID
   * @param repository — repository name
   * @param findings — the current batch of findings from this review
   * @param measures — SonarQube measures (or null)
   */
  static computeMetrics(
    store: Pick<FindingStore, "getFindingsByPr">,
    prId: number,
    repository: string,
    findings: NormalizedFinding[],
    measures: unknown,
  ): ReviewMetrics {
    const allPrFindings = store.getFindingsByPr(prId, repository);

    // ── Valid / false-positive classification ──
    let validCount = 0;
    let falsePositiveCount = 0;
    let pendingCount = 0;

    for (const f of allPrFindings) {
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

    // ── CVE count ──
    const cveFindings = findings.filter(
      (f) => f.sourceEngine === "sonarqube-cve",
    );
    const cveCritical = cveFindings.filter(
      (f) => f.severity === "critical",
    ).length;

    // ── Coverage issues ──
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

    // ── Resolution rate (across all time for this PR) ──
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
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run agents/ratan-code-review-agent/src/review/workflows/services/metrics-service.spec.ts`
Expected: PASS (8 tests)

- [ ] **Step 4: Commit**

```bash
git add agents/ratan-code-review-agent/src/review/workflows/services/metrics-service.ts agents/ratan-code-review-agent/src/review/workflows/services/metrics-service.spec.ts
git commit -m "feat: add MetricsService — compute valid rates, CVE counts, and coverage metrics"
```

---

### Task 3: Create record-metrics step and wire into workflow

**Files:**
- Create: `agents/ratan-code-review-agent/src/review/workflows/steps/record-metrics.ts`
- Modify: `agents/ratan-code-review-agent/src/review/workflows/pr-review-workflow.ts`

Note: This step internally creates its own `FindingStore` via the bootstrap config (matching the pattern of `record-audit.ts`). The computation logic is tested separately in Task 2. The step test is omitted because it would require mocking the bootstrap session — the step is a thin orchestration wrapper.

- [ ] **Step 1: Write the record-metrics step**

Create `agents/ratan-code-review-agent/src/review/workflows/steps/record-metrics.ts`:

```ts
import { defineStep } from "../../runtime";
import z from "zod";
import { FindingStore } from "finding-store";
import { extractAgentConfig } from "../../../bootstrap/session";
import { type CommonRequestContext, PullRequestSchema } from "../../types";
import { NormalizedFindingSchema } from "../../types/finding";
import { MetricsService } from "../services/metrics-service";

const RecordMetricsInputSchema = z.object({
  prDetails: PullRequestSchema,
  workItemContext: z.string().optional(),
  findings: z.array(NormalizedFindingSchema),
  correlationSummary: z.string(),
  changesSinceLastReview: z.string().optional(),
  reviewSummary: z.string(),
  reviewExecutionStatus: z.enum(["complete", "incomplete"]),
  reviewMetadata: z.record(z.string(), z.unknown()),
  measures: z.union([z.any(), z.null()]),
  mergeDecision: z.enum(["allowed", "blocked", "pending"]),
});

const RecordMetricsOutputSchema = RecordMetricsInputSchema.extend({
  metricsRecordId: z.string().uuid(),
});

export const recordMetrics = defineStep({
  id: "record-metrics",
  description: "Compute and persist review performance metrics",
  inputSchema: RecordMetricsInputSchema,
  outputSchema: RecordMetricsOutputSchema,
  execute: async ({ inputData, requestContext }) => {
    if (!inputData) {
      throw new Error("Input data not found");
    }

    const agentConfig = extractAgentConfig(
      requestContext as unknown as CommonRequestContext,
    );
    const rootConfig = await agentConfig.getRootConfig();
    const findingStore = new FindingStore(
      rootConfig.findingStorePath ?? ".ratan/data/findings.db",
    );
    await findingStore.init();

    try {
      const metrics = MetricsService.computeMetrics(
        findingStore,
        inputData.prDetails.pullRequestId,
        inputData.prDetails.repoName,
        inputData.findings,
        inputData.measures,
      );

      findingStore.saveMetrics(metrics);
      findingStore.saveToDisk();

      return {
        ...inputData,
        metricsRecordId: metrics.id,
      };
    } finally {
      findingStore.close();
    }
  },
});
```

- [ ] **Step 2: Wire into pr-review-workflow.ts**

In `agents/ratan-code-review-agent/src/review/workflows/pr-review-workflow.ts`:

Add the import alongside the other step imports (around line 14):

```ts
import { recordMetrics } from "./steps/record-metrics";
```

Replace the final `runSteps` call (line 152-156) to include `recordMetrics` before `mergeGate`:

```ts
  await runSteps(
    [recordMetrics, mergeGate, recordAudit, createWorkItems, comment],
    current,
    stepOptions,
  );
```

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `npx vitest run`
Expected: All existing tests pass (271+ tests)

- [ ] **Step 4: Commit**

```bash
git add \
  agents/ratan-code-review-agent/src/review/workflows/steps/record-metrics.ts \
  agents/ratan-code-review-agent/src/review/workflows/pr-review-workflow.ts
git commit -m "feat: add record-metrics workflow step and wire into pr-review-workflow"
```

---

### Task 4: Add /api/metrics dashboard backend endpoint

**Files:**
- Modify: `agents/ratan-code-review-agent/src/cli/dashboard/index.ts`
- Modify: `agents/ratan-code-review-agent/src/cli/dashboard/index.spec.ts`

- [ ] **Step 1: Add /api/metrics route to the Hono app**

In `agents/ratan-code-review-agent/src/cli/dashboard/index.ts`, after the `/api/prs` route block (around line 323), add:

```ts
  // ── Review Performance Metrics ──────────────────────────────────────────

  app.get("/api/metrics", (c) => {
    try {
      const prId = c.req.query("prId") ? Number(c.req.query("prId")) : undefined;

      if (prId !== undefined) {
        if (!Number.isInteger(prId) || prId <= 0) {
          c.status(400);
          return c.json({ error: "prId must be a positive integer" });
        }
        const repo = c.req.query("repo");
        if (!repo) {
          c.status(400);
          return c.json({ error: "repo is required when prId is specified" });
        }
        const perReview = findingStore.queryMetrics(prId, repo);
        return c.json({ perReview, total: perReview.length });
      }

      const aggregate = findingStore.queryAggregatedMetrics();
      return c.json({ aggregate });
    } catch (err) {
      c.status(500);
      return c.json({ error: String(err) });
    }
  });
```

- [ ] **Step 2: Write the failing test for /api/metrics**

Add to the existing test in `agents/ratan-code-review-agent/src/cli/dashboard/index.spec.ts`:

Append inside the `describe("dashboard data routes", ...)` block, before `store.close()` (around line 167), add:

```ts
    // ── Metrics API ──
    store.saveMetrics({
      id: "550e8400-e29b-41d4-a716-446655440030",
      prId: 7,
      repository: "repo-a",
      auditRecordId: null,
      totalFindings: 5,
      resolvedFindings: 2,
      validFindingCount: 2,
      falsePositiveCount: 1,
      pendingFeedbackCount: 2,
      cveFindings: 1,
      cveCritical: 0,
      coverageBelowThreshold: 0,
      hadCoverageData: 1,
      resolutionRate: 0.4,
      validRate: 2 / 3,
      computedAt: "2026-07-20T00:00:00.000Z",
    });
    const metricsResp = await get("/api/metrics");
    expect(metricsResp.aggregate).toBeDefined();
    expect(metricsResp.aggregate.totalReviews).toBe(1);
    expect(metricsResp.aggregate.averageValidRate).toBeCloseTo(2 / 3, 1);

    const metricsPerPr = await app.request("/api/metrics?prId=7&repo=repo-a");
    expect(metricsPerPr.status).toBe(200);
    const perPrBody = await metricsPerPr.json();
    expect(perPrBody.perReview).toHaveLength(1);
    expect(perPrBody.perReview[0].cveFindings).toBe(1);
```

Also add `saveMetrics` to the existing store import in the test (it's available through the FindingStore class which already has it from Task 1).

- [ ] **Step 3: Run tests to verify the endpoint works**

Run: `npx vitest run agents/ratan-code-review-agent/src/cli/dashboard/index.spec.ts`
Expected: PASS (existing tests + new metrics assertions)

- [ ] **Step 4: Commit**

```bash
git add agents/ratan-code-review-agent/src/cli/dashboard/index.ts agents/ratan-code-review-agent/src/cli/dashboard/index.spec.ts
git commit -m "feat(dashboard): add /api/metrics endpoint for review performance metrics"
```

---

### Task 5: Add fetchMetrics() to dashboard frontend API

**Files:**
- Modify: `agents/ratan-code-review-agent/dashboard/src/api.ts`

- [ ] **Step 1: Add fetchMetrics() function**

In `agents/ratan-code-review-agent/dashboard/src/api.ts`, after `clearPendingQueue()` (around line 107), add:

```ts
// ── Metrics API ────────────────────────────────────────────────────────────────

/**
 * Fetch review performance metrics.
 * Without params: returns aggregate across all PRs.
 * With prId + repo: returns per-review metric history for that PR.
 */
export async function fetchMetrics(params?: {
  prId?: number;
  repo?: string;
}): Promise<any> {
  const searchParams = new URLSearchParams();
  if (params?.prId) searchParams.set("prId", String(params.prId));
  if (params?.repo) searchParams.set("repo", params.repo);
  const qs = searchParams.toString();
  const res = await fetch(`${API_BASE}/metrics${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`Failed to fetch metrics: ${res.statusText}`);
  return res.json();
}
```

- [ ] **Step 2: Commit**

```bash
git add agents/ratan-code-review-agent/dashboard/src/api.ts
git commit -m "feat(dashboard): add fetchMetrics() frontend API function"
```

---

### Task 6: Add summary cards and performance trends to DashboardOverview

**Files:**
- Modify: `agents/ratan-code-review-agent/dashboard/src/pages/DashboardOverview.tsx`

- [ ] **Step 1: Update imports and fetch metrics data**

In `DashboardOverview.tsx`, update the import from `../api`:

```ts
import { fetchFindings, fetchStats, fetchMetrics } from "../api";
```

In the `useEffect`, add `fetchMetrics()` alongside the existing fetches:

```ts
  useEffect(() => {
    Promise.all([
      fetchFindings().then((d) => d.findings ?? []).catch(() => []),
      fetchStats().catch(() => null),
      fetchMetrics().catch(() => null),
    ])
      .then(([f, s, m]) => {
        setFindings(f);
        setStats(s);
        setMetrics(m?.aggregate ?? null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
```

Add `metrics` state variable:

```ts
  const [metrics, setMetrics] = useState<any>(null);
```

- [ ] **Step 2: Add summary cards row (above existing charts)**

After the existing `<h1>` and before the existing `<div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)" }}>` block, add:

```tsx
      {metrics && metrics.totalReviews > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "1rem",
            marginBottom: "2rem",
          }}
        >
          <SummaryCard
            title="Valid Finding Rate"
            value={metrics.averageValidRate !== null
              ? `${(metrics.averageValidRate * 100).toFixed(0)}%`
              : "N/A"}
            color="#2ecc71"
          />
          <SummaryCard
            title="Resolution Rate"
            value={metrics.averageResolutionRate !== null
              ? `${(metrics.averageResolutionRate * 100).toFixed(0)}%`
              : "N/A"}
            color="#3498db"
          />
          <SummaryCard
            title="CVEs Detected"
            value={metrics.totalCveDetected}
            color="#e94560"
          />
          <SummaryCard
            title="Coverage Issues"
            value={metrics.totalCoverageIssues}
            color="#f5a623"
          />
        </div>
      )}
```

- [ ] **Step 3: Add "Performance Trends" section (below existing Recent Activity)**

After the existing recent-activity block (around line 187), add:

```tsx
      {metrics && metrics.totalReviews > 0 && (
        <div style={{ marginTop: "2rem" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>
            Performance Trends
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "1.5rem",
            }}
          >
            <div
              style={{
                background: "#fff",
                padding: "1rem",
                borderRadius: 8,
                boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
              }}
            >
              <h3 style={{ marginBottom: "1rem" }}>Valid Finding Rate</h3>
              <p style={{ color: "#666", fontSize: "0.85rem" }}>
                {metrics.totalReviews} review{metrics.totalReviews !== 1 ? "s" : ""}
                {" "}
                &mdash; {metrics.averageValidRate !== null
                  ? `${(metrics.averageValidRate * 100).toFixed(0)}%` : "N/A"}
                {" "}
                average valid rate
              </p>
            </div>

            <div
              style={{
                background: "#fff",
                padding: "1rem",
                borderRadius: 8,
                boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
              }}
            >
              <h3 style={{ marginBottom: "1rem" }}>CVE Detection</h3>
              <p style={{ color: "#666", fontSize: "0.85rem" }}>
                {metrics.totalCveDetected} CVE
                {metrics.totalCveDetected !== 1 ? "s" : ""} detected across{" "}
                {metrics.reviewsWithCve} review
                {metrics.reviewsWithCve !== 1 ? "s" : ""}
              </p>
            </div>

            <div
              style={{
                background: "#fff",
                padding: "1rem",
                borderRadius: 8,
                boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
              }}
            >
              <h3 style={{ marginBottom: "1rem" }}>Resolution Rate</h3>
              <p style={{ color: "#666", fontSize: "0.85rem" }}>
                {metrics.averageResolutionRate !== null
                  ? `${(metrics.averageResolutionRate * 100).toFixed(0)}%`
                  : "N/A"}
                {" "}
                average resolution rate
              </p>
            </div>

            <div
              style={{
                background: "#fff",
                padding: "1rem",
                borderRadius: 8,
                boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
              }}
            >
              <h3 style={{ marginBottom: "1rem" }}>Coverage Issues</h3>
              <p style={{ color: "#666", fontSize: "0.85rem" }}>
                {metrics.totalCoverageIssues} review
                {metrics.totalCoverageIssues !== 1 ? "s" : ""} with coverage
                below threshold
              </p>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 4: Commit**

```bash
git add agents/ratan-code-review-agent/dashboard/src/pages/DashboardOverview.tsx
git commit -m "feat(dashboard): add performance metrics summary cards and trends section"
```

---

### Task 7: Documentation update

**Files:**
- Modify: `agents/ratan-code-review-agent/docs/RUNTIME_ARCHITECTURE.md`

- [ ] **Step 1: Update runtime architecture doc**

In `agents/ratan-code-review-agent/docs/RUNTIME_ARCHITECTURE.md`, update the workflow diagram/description to include the `record-metrics` step after `sonarqube-measures`:

```
scanner-pipeline → sonarqube-measures → record-metrics → merge-gate → record-audit → create-workitems → comment
```

Also add a description of the `review_metrics` table and the metrics computed.

- [ ] **Step 2: Commit**

```bash
git add agents/ratan-code-review-agent/docs/RUNTIME_ARCHITECTURE.md
git commit -m "docs: update runtime architecture with record-metrics step and review_metrics table"
```

---

## Verification

After all tasks are committed:

1. Run `npx vitest run` — expects 280+ tests passing
2. Run `pnpm build` — all packages compile without errors
3. Run `pnpm agent:build` — agent builds cleanly
