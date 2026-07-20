# finding-store

SQLite persistence for normalized findings, ADO thread associations, overrides,
and audit records.

In addition to write/reconciliation operations, dashboard consumers use
`queryFindings()` for optional PR/repository/engine/resolution filtering and
`queryOverrideLog()` for override history. PostgreSQL is not a runtime backend.

```bash
pnpm --filter finding-store build
```
