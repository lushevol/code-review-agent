# Review Performance Metrics

## Overview

Track code review effectiveness each time a PR is revisited, storing computed metrics in the
existing SQLite finding-store and surfacing them on the dashboard.

Metrics are computed per-review (each audit record / revisit) and aggregated across all PRs.

## Metrics Definition

| Metric | Computation |
|--------|------------|
| **Valid finding rate** | `validCount / (validCount + falsePositiveCount)` where valid = finding resolved via follow-up commit (`resolvedByCommitHash` present), or manually resolved, or received a 👍 reaction. FP = overridden as `false-positive`/`waived`/`accepted-risk`, or received a 👎 / FP flag. Findings with no conclusive feedback are excluded from the rate denominator. |
| **False-positive rate** | `1 - validRate` |
| **CVE findings before release** | Count of findings where `source_engine = 'sonarqube-cve'` at the time of this review, with separate sub-counts for critical severity. |
| **Coverage issues before release** | Whether SonarQube coverage measures fell below configured thresholds when this review ran. |
| **Resolution rate** | `findings WHERE resolution = 'resolved' / total findings` for the PR at this point (across all time, not just this review). `superseded` findings are *replaced* not fixed, so they do not count toward the resolution rate. |

## Data Model

### New table: `review_metrics`

```sql
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

The `audit_record_id` column links back to `audit_records.id`, so each metric snapshot
corresponds to one review run and is traceable.

### Exposed TypeScript types

```ts
interface ReviewMetrics {
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

## Computation Logic

Metrics are computed in a new `compute-review-metrics` step that runs after
`scanner-pipeline` and before `record-audit` in the workflow.

For each review:

1. Load all findings for this PR from the finding-store (includes prior reconciled findings).
2. For **valid/false-positive classification**, inspect each finding with a conclusive status:
   - `resolvedByCommitHash` is non-null → valid (developer fixed it)
   - Resolution is `resolved` via manual override → valid
   - No override, still `open` → pending (not counted)
   - Resolution is `false-positive` or `waived` or `accepted-risk` → false-positive
   - ADO feedback with 👍 → valid (requires feedback-service lookups)
3. Count **CVE findings** by filtering `source_engine = 'sonarqube-cve'` in the current findings batch.
4. Check **coverage** from the `measures` data (coverage below threshold).
5. For **resolution rate**, count `resolved + superseded` over total findings for the PR across all time.
6. Persist to `review_metrics` table.

### "Revisit" trigger

The `scanner-pipeline` step already calls `reconcileAndPersistFindings` on every run when prior
findings exist. The new compute step runs unconditionally after that — it sees the fully
reconciled state of all findings for the PR, making it the natural point to snapshot metrics.

## Workflow Integration

Add a new step `computeReviewMetrics` to `pr-review-workflow.ts`, placed after
`sonarqubeMeasures` (which provides the coverage data needed for coverage-issue
metrics) and before the final `mergeGate`/`recordAudit`/`createWorkItems`/`comment` block:

```
scanner-pipeline → sonarqubeMeasures → computeReviewMetrics → mergeGate → recordAudit → createWorkItems → comment
```

The step receives the scanner-pipeline output (findings, measures, etc.) and produces metric data
that flows downstream. `recordAudit` gets an extra field for the metrics record ID.

### Step definition

New file: `agents/ratan-code-review-agent/src/review/workflows/steps/record-metrics.ts`

- Input schema: extends scanner-pipeline output (findings + measures + prDetails)
- Output schema: extends input with `metricsRecordId: string`
- Implementation: instantiate `FindingStore`, compute metrics, upsert, flush, close

### Service

New file: `agents/ratan-code-review-agent/src/review/workflows/services/metrics-service.ts`

- `computeMetrics(store, prId, repository, findings, measures): ReviewMetrics`
- Pure computation separated from IO for testability

## Backend API

New route on the existing Hono dashboard app (`/api/metrics`):

```
GET /api/metrics
  → aggregate metrics across all PRs
  ?prId=123   → per-PR metric history (trend across revisits)
  ?period=7d  → time-windowed aggregates
```

### Response shape

```json
{
  "aggregate": {
    "averageValidRate": 0.87,
    "averageResolutionRate": 0.72,
    "totalCveDetected": 34,
    "totalReviewsWithCve": 12,
    "coverageIssuesFound": 5,
    "totalReviews": 48
  },
  "perReview": [
    {
      "id": "uuid",
      "prId": 7,
      "repository": "my-repo",
      "reviewNumber": 2,
      "validRate": 0.83,
      "resolutionRate": 0.67,
      "cveFindings": 2,
      "coverageBelowThreshold": 0,
      "computedAt": "2026-07-23T10:00:00Z"
    }
  ]
}
```

The `perReview` array is sorted by `computedAt` descending, so the frontend can trivially
reverse it for trend-line rendering. `reviewNumber` is the ordinal of this audit record for the
given `(prId, repository)`, computed by counting prior audit records.

## Dashboard UI

### New summary cards row (above existing charts)

| Valid Finding Rate | Resolution Rate | CVEs Detected | Coverage Issues |
|-------------------|-----------------|---------------|-----------------|
| 87% ✅            | 72%             | 34 across all PRs | 5 ⚠️ |

Shown only when metrics data exists.

### New "Performance Trends" section (below existing Recent Activity)

Three visualizations:

1. **Valid Rate Trend** — Recharts `LineChart` with per-review valid rate on the Y axis
   and review date on the X axis. Shows whether the review engine is getting more or less accurate
   over time.
2. **CVE Detection** — Recharts `BarChart` showing CVE count per review over time.
   Demonstrates the "caught before release" value.
3. **Resolution Rate by PR** — Recharts `BarChart` showing resolution rate per recent PR.
   Shows whether teams are acting on findings.

All three charts are collapsed under a single "Performance Trends" heading that is hidden entirely
when no metrics data exists.

### Frontend changes

- `dashboard/src/api.ts` — new `fetchMetrics()` function
- `dashboard/src/pages/DashboardOverview.tsx` — new summary cards + performance section
- Charts match existing style: Recharts, same color palette, card-wrapped in white with shadow

## Files Changed

| File | Change |
|------|--------|
| `packages/finding-store/src/index.ts` | Add `review_metrics` DDL, `ReviewMetrics` type, `saveMetrics()`, `queryMetrics()`, `queryAggregatedMetrics()` methods |
| `agents/ratan-code-review-agent/src/review/workflows/steps/record-metrics.ts` | New step — compute and persist metrics |
| `agents/ratan-code-review-agent/src/review/workflows/services/metrics-service.ts` | New service — computation logic |
| `agents/ratan-code-review-agent/src/review/workflows/pr-review-workflow.ts` | Wire `computeReviewMetrics` step into workflow |
| `agents/ratan-code-review-agent/src/cli/dashboard/index.ts` | Add `/api/metrics` route |
| `agents/ratan-code-review-agent/dashboard/src/api.ts` | Add `fetchMetrics()` |
| `agents/ratan-code-review-agent/dashboard/src/pages/DashboardOverview.tsx` | New summary cards + performance trends section |

## Out of Scope

- Real-time metric recalculation when new feedback arrives (re-computed on next review)
- Export/download of metrics data
- Alerting or threshold-based notifications
- Historical backfill for existing audit records

## Verification

1. Unit test for `MetricsService.computeMetrics()` — valid/FP classification, CVE count, resolution rate
2. Unit test for the `record-metrics` step — input → output passthrough + persistence
3. Unit test for dashboard `/api/metrics` — aggregate and per-PR queries
4. Integration: run two reviews of the same PR with changing findings → verify metrics differ per visit
5. Dashboard: visit Overview page with metrics data → cards and charts render
