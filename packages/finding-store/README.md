# finding-store

FindingStore persists review state in a `sql.js` SQLite file. Initialization
uses `PRAGMA user_version` migrations: current unversioned databases upgrade
transactionally to schema version 1, while files created by a newer unsupported
schema version are rejected. Add each future schema change as the next ordered
migration and bump `CURRENT_SCHEMA_VERSION` in the same release.

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
