# AI Harness Guide

## Purpose

Use this document as the operating guide for an AI harness that analyzes, modifies, tests, or runs `ratan-code-review-agent`.

The harness should treat this package as a PR-review automation system with real external side effects. Running the full startup or workflow can call Azure DevOps, call SonarQube, call an OpenAI-compatible model endpoint, and post comments to pull requests.

## Harness Objectives

An AI harness working on this project should be able to:

- Understand the code review workflow and its side effects.
- Modify native OpenCodeReview rules, schemas, focus routing, and workflow steps safely.
- Add tests or evaluation cases without posting to live PRs.
- Run build and local validation commands when dependencies are available.
- Keep sensitive company data and credentials out of source code and logs.

## Safe Default Mode

Default to analysis and local validation. Do not run PR scanning or comment-posting code unless the user explicitly asks for live integration testing.

Safe activities:

- Read source files.
- Edit TypeScript, Markdown, schemas, and fixtures.
- Run type/build/test commands that do not require network access.
- Add unit tests with mocked `agent-config-manager`, ADO, SonarQube, and local review agent calls.
- Generate or update evaluation fixtures.

Side-effectful activities:

- `ratan-code-review start` or `start --watch`
- `startReviewPrWithProvider(...)` with real config
- `prReviewWorkflow` against a real `prId`
- any call path that reaches `addCommentThreadForPRCode`, `addCommentForPR`, or `setPullRequestProperties`

## Setup

Expected local stack:

```bash
node --version
npm --version
pnpm --version
pnpm install
```

Use pnpm 9+ (compatible with pnpm 11).

Expected environment:

```env
ADO_TOKEN=...
ADO_CONFIG_REPO=...
ADO_CONFIG_BRANCH=...
ADO_ORGANIZATION=...
ADO_PROJECT=...
ADO_CONFIG_BASE_PATH=...
ADO_PROXY_URL=none
OCR_LLM_TOKEN=...
SONARQUBE_TOKEN=...
```

Use `ADO_PROXY_URL=none` when the host can reach Azure DevOps directly. Omit it or set a proxy URL when the host must use a corporate proxy.

## Azure DevOps MCP Access

Codex has a global Azure DevOps MCP server registered as `azure-devops`.
The server launcher is `scripts/ado-mcp.sh`. It reads the project `.env`,
derives the MCP `PERSONAL_ACCESS_TOKEN` from `ADO_TOKEN` at runtime, and runs:

```bash
npx -y @azure-devops/mcp "$ADO_ORGANIZATION" --authentication pat
```

The launcher has been smoke-tested with newline-delimited JSON-RPC and exposes
Azure DevOps MCP tools for organization `lushe`. If tools are not visible in a
running Codex session, restart Codex or open a new session so the newly
registered MCP server is loaded.

The production LLM endpoint, token, model, and provider mode are configured under
`config.openCodeReview.llm`. Use `env:NAME` references for secrets rather than
embedding them in `.ratan/config.json`. OpenCodeReview rules live in the native
JSON file referenced by `config.openCodeReview.rulesPath`.

## Validation Commands

Use these commands when dependencies are installed:

```bash
# Build all packages
pnpm build

# Run tests
pnpm test

# Run package coverage without external service calls
pnpm --filter ratan-code-review test:coverage

# Validate all golden fixtures without calling an LLM
pnpm --filter ratan-code-review evaluate:golden --dry-run

# CLI usage (after build)
node bin/ratan-code-review.cjs --help
node bin/ratan-code-review.cjs start --help
node bin/ratan-code-review.cjs dashboard  # start dashboard server

# Root help includes the operational start/direct-PR/watch/dashboard cheatsheet

# Live side-effectful commands (not safe default)
pnpm dev
```

The `start` CLI command has external side effects (ADO calls) and requires a valid config.

## Suggested Harness Test Strategy

Start with unit tests around pure utilities:

- `maskSensitiveData`
- `selectReviewFocuses`
- finding content-hash generation and correlation

Then test workflow steps with mocked runtime context and mocked clients:

- `fetch-pr-details` should fetch cloneable metadata and linked work-item ids through existing ADO client methods.
- `open-code-review-scanner` should pass the resolved native rule file unchanged, include selected focus reasons in the background, and map OCR comments to normalized findings.
- `OpenCodeReviewRunner` should map unknown string comment categories to `other` while rejecting structurally malformed comments.
- `scanner-pipeline` should preserve graceful degradation, propagate incomplete OCR status, correlate by content hash, persist stable finding IDs, and present actionable blocking/important/advisory category sections with selected focuses.
- `pr-review-workflow` should retain workspace-selected focuses in its incomplete fallback when scanner execution throws.
- `sonarqube-measures` should return `null` on missing client or fetch errors.
- `comment-review-results` should render prioritized inline notes with bounded escaped Markdown headings and plain fenced suggested-fix code, refresh previously linked threads, order blocking and higher-severity findings first, apply the 30-comment cap last, link created ADO threads to persisted findings, post exactly one decision-derived conclusion last with compact SonarQube results, remove prior agent-generated conclusions, and update the latest-review PR property.
- Continued-commit tests should verify fixed findings persist as resolved and close linked ADO threads, unchanged findings reuse their threads, new findings create threads, mixed commits reconcile all three outcomes, incomplete scans preserve prior state, merge decisions transition in both directions, SonarQube values refresh, and stale in-flight reviews cannot publish after a newer review starts.
- `FeedbackService` should synchronize only threads explicitly associated with each finding.
- `record-audit` should persist only allowlisted pilot metrics and must discard secret-like or arbitrary OCR metadata.
- `/api/audit` should export routed outcome metrics before any focus/status UI filters are added.
- Dashboard HTTP tests should cover unfiltered and independently filtered findings, override history, repository-aware PR aggregation, and stats. UI builds should cover queue clearing and current scanner names.

Do not use real ADO or SonarQube clients in automated tests.

## Golden PR Finding Harness

The deterministic scorer lives in `src/evaluation/golden-evaluator.ts`; its
fixtures live under `src/evaluation/dataset/golden/`. The corpus currently has
25 synthetic PR changes across eight languages/formats, including three clean
changes that detect hallucinated findings. It covers bugs, security,
performance, maintainability, tests, and documentation findings.

Golden fixture format:

```json
{
  "id": "ts-sql-injection",
  "language": "typescript",
  "title": "Find users by request id",
  "description": "Adds a database lookup endpoint.",
  "files": [
    {
      "path": "src/users.ts",
      "changeType": "added",
      "after": "..."
    }
  ],
  "expectedFindings": [
    {
      "id": "sql-injection",
      "filePath": "src/users.ts",
      "lineStart": 4,
      "lineEnd": 4,
      "category": "security",
      "allowedSeverities": ["critical", "high"],
      "messageIncludes": ["sql", "parameter"]
    }
  ],
  "allowedExtraFindings": 0
}
```

Golden files currently support `added` and `modified` changes. Add rename or
deletion support only together with representative fixtures and materialization
tests.

`evaluateGoldenCase` uses one-to-one matching across normalized file path,
line overlap with tolerance, category, allowed severity, and required message
concepts. It reports per-case recall and precision and fails on missed findings
or excess findings. A single actual finding cannot satisfy two expectations.

`evaluate:golden --dry-run` only validates and lists fixtures. Without
`--dry-run`, the runner materializes each selected case as an isolated two-commit
Git repository and calls `OpenCodeReviewRunner`; it does not initialize ADO,
SonarQube, persistence, merge gates, or comment publication. Select cases with
repeatable `--case <id>` options; at least one `--case` is mandatory in live
mode. This mode sends synthetic source to the
configured external LLM endpoint, so it must remain explicit and opt-in.
`skipped` and `completed_with_errors` OCR outcomes fail the case even when a
clean fixture receives no comments.

`--judge` adds a second, qualitative pass through `LlmEvaluationJudge`. It
scores false-positive risk and suggestion quality from synthetic fixture data.
Judge failures or scores never alter the deterministic golden pass/fail result.

The corrected `ts-sql-injection` case has been live-verified with one expected
critical finding, recall `1.0`, and precision `1.0`.

## OpenCodeReview Harness

The harness should verify the native rule file is valid JSON and passed unchanged
to `ocr review --rule`. Review-focus routing is deterministic: `general` always
applies, while changed code may also select `tests`, `error-handling`,
`type-design`, or `comments`. The selections and reasons are injected into OCR
background context and returned in scanner metadata; they do not cause extra LLM
calls.

The runner must execute OCR against its temporary masked two-commit repository,
never the source checkout. Tests should inspect the Git diff presented to OCR and
verify raw credentials are absent while per-run keyed markers preserve whether a
credential value changed.

## Live Run Checklist

Before allowing live PR review:

- Run `ratan-code-review start --pr-id <test-pr-id>` to scaffold a valid config and verify connectivity against a dedicated test PR first. Explicit PR reviews run directly, wait for the workflow, surface failures, and bypass the automatic-scan build-status gate so repositories without CI can be used for a bounded pilot.
- Run `pnpm verify:release -- --pr-id <test-pr-id>` for read-only npm, installed-CLI, secret-presence, ADO-authentication, and PR-access checks. Add `--expect-decision allowed|blocked` to assert the remote merge status, newest-thread placement, single canonical summary, SonarQube/commit fields, and current-format inline state. Add `--expect-fenced-suggestion` when the fixture should produce suggested code. Use `--scan-pr` only when ADO comment and status side effects are intended.
- Confirm the target repositories and PR age window in root config.
- Confirm `ADO_TOKEN`, the token referenced by `config.openCodeReview.llm.token`, and optional `SONARQUBE_TOKEN` are scoped correctly.
- Confirm the configured OpenCodeReview model endpoint is running and compatible with the selected provider mode.
- Confirm `.ratan/opencodereview/rule.json` is valid native OCR rule JSON.
- Confirm OCR rule scope and merge-policy configuration.
- Run against a dedicated test PR before enabling broad scanning.

Current status: the complete suite has 38 test files and 259 passing tests,
the loopback dashboard integration test passes separately. Package coverage from
the prior full coverage run is 62.35% statements,
51.1% branches, 67.55% functions, and 63.37% lines. The scanner pipeline,
OpenCodeReview runner and focus router, FindingStore finding/thread associations,
feedback synchronization, webhook receiver, merge gate, work-item creation, and
dashboard are implemented. The 2026-07-19 dedicated synthetic `example-repo`
PR `#5` completed a published-package two-iteration pilot with
`ratan-code-review@0.1.8`. The vulnerable commit produced a failed merge status,
one critical linked inline comment, and one canonical `Changes requested`
summary. A real follow-up commit parameterized the query; its review marked the
linked thread Fixed, posted a succeeded status, and updated the same summary to
`No blocking issues`. The summary retained the SonarQube result and reviewed
commit in both states. A pre-`0.1.8` inline thread without a persisted finding
association required one-time manual cleanup; associations created by `0.1.8`
reconciled correctly.
Fresh synthetic PR `#6` verified newest-conclusion replacement in published
`ratan-code-review@0.1.9`, while rendered inspection exposed literal bold
markers in its long title and ADO's apply-suggestion widget. Published `0.1.10`
reformatted the linked finding as a bounded escaped H3 plus plain code fence.
A real continuation fix commit parameterized the query; the subsequent review
marked the finding Resolved, posted a succeeded merge status, and created the
sole allowed conclusion as the highest visible thread.

The Phase 3 live pilot is side-effectful. Require explicit authorization, a
bounded repository/PR cohort, and scoped credentials before running it. Do not
make focus-retention, confidence-threshold, or blocking-policy decisions until
the pilot report has been reviewed.

## Recommended Improvements

- [DONE] Move production model URL, token, model, and provider mode to `config.openCodeReview.llm`, with `env:` references for secrets.
- [DONE] Add focused Vitest coverage for OCR configuration, focus routing, persistence, and workflow integration.
- [DONE] Add a deterministic golden PR finding scorer and opt-in live OCR runner.
- [DONE] Replace the legacy ADO formatter with a concise decision-derived conclusion posted as the newest thread, remove duplicate agent conclusions, fence suggested fixes, and refresh linked inline notes.
- Log inline comment failures with enough context to debug without exposing secrets.
- Add dry-run mode so the full workflow can execute without writing PR comments.
- Add webhook server graceful shutdown and restart recovery.
- Add dashboard authentication/authorization.
