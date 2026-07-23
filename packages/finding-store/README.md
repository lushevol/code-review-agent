# finding-store

SQLite persistence for normalized findings, ADO thread associations, overrides,
audit records, and review metrics.

In addition to write/reconciliation operations, dashboard consumers use
`queryFindings()` for optional PR/repository/engine/resolution filtering,
`queryOverrideLog()` for override history, `queryMetrics()` for per-PR review
metrics, and `queryAggregatedMetrics()` for cross-PR aggregates. PostgreSQL is
not a runtime backend.

```bash
pnpm --filter finding-store build
```
