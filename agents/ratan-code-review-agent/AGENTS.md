# AI Agent Instructions

This package is the production Azure DevOps review runtime. OpenCodeReview is
the sole LLM review engine; the surrounding TypeScript workflow owns workspace
preparation, optional scanners, persistence, governance, comments, evaluation,
and dashboard APIs.

## Working Rules

- Keep live ADO, SonarQube, and LLM calls opt-in. Unit and integration tests use
  mocks or synthetic repositories.
- Preserve native OpenCodeReview rule ownership. Do not add a second production
  review agent, confidence rescore chain, or invented confidence value.
- Keep `RequestContext` limited to session-scoped dependencies; pass workflow
  data through validated step inputs and outputs.
- Treat comment and status publication as governance output. A newer review must
  not allow stale output to overwrite the latest decision.
- Never hard-code credentials or provider URLs. Use
  `config.openCodeReview.llm` and `env:NAME` references.
- Changed Git content must reach OpenCodeReview only through the runner's
  temporary masked repository. Do not bypass that adapter.

## Repo Map

- `src/index.ts`: intentionally narrow programmatic exports.
- `src/bootstrap`: config sessions and explicit PR review startup.
- `src/cli`: start/dashboard commands, queue, auto-scan, and config loading.
- `src/review/open-code-review`: OCR process adapter, masking boundary, and
  deterministic focus routing.
- `src/review/runtime`: small schema-validated sequential-step runner.
- `src/review/workflows`: scanner pipeline, governance steps, persistence,
  comments, feedback, audit, and reconciliation.
- `src/review/types`: current PR and finding contracts.
- `src/evaluation`: 25-case synthetic golden corpus, deterministic evaluation,
  and opt-in qualitative LLM judge.
- `dashboard`: React SPA; `src/cli/dashboard` is its Express API.

## Commands

```bash
pnpm --filter ratan-code-review typecheck
pnpm --filter ratan-code-review exec vitest run
pnpm --filter ratan-code-review build
pnpm --filter ratan-code-review evaluate:golden --dry-run
pnpm --filter ratan-code-review evaluate:golden --case ts-sql-injection
pnpm --filter ratan-code-review evaluate:golden --case ts-sql-injection --judge
```

`start`, `start --watch`, and `start --pr-id` can call external systems and post
ADO comments/statuses. The dashboard API integration test binds loopback and may
need execution outside a restricted sandbox.

## Runtime Assumptions

- Node.js 20+ and pnpm 9+ (including pnpm 11) are supported.
- `ADO_TOKEN` is required for live ADO access.
- `config.openCodeReview.llm` owns URL, token, model, and Anthropic mode. Watch
  health checks use that configured endpoint and credential.
- `--repo-pattern` overrides configured scan repository globs for that process.
- SonarQube is optional and degrades to unavailable results.
- SQLite `FindingStore` is the only runtime persistence implementation.
- The optional evaluation judge sends synthetic golden content to the configured
  endpoint; its scores are reported separately and never change pass/fail.

## Known Care Points

- Per-line ADO comment failures are non-fatal; the canonical conclusion is still
  posted last and older generated conclusions are removed.
- Dashboard finding queries must preserve repository identity because ADO PR ids
  can collide across repositories.
- Linked and commit-referenced work-item ids are deduplicated before context is
  fetched.
- The runner masks changed text in an isolated Git range with per-run keyed
  replacement markers, preserving changed-versus-unchanged evidence without
  exposing raw secrets or reusable hashes.
