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

- `pnpm demo`
- `startup(...)`
- `scanPRs(...)` with real config
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
DATABASE_URL=...
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

# Regenerate evaluation JSON schema
pnpm --filter ratan-code-review codegen

# CLI usage (after build)
node bin/ratan-code-review.cjs --help
node bin/ratan-code-review.cjs start --help
node bin/ratan-code-review.cjs dashboard  # start dashboard server

# Live side-effectful commands (not safe default)
pnpm dev
pnpm demo
```

`pnpm demo` is not a safe default because it starts the live PR scanning flow from `src/demo.ts`. The `start` CLI command also has external side effects (ADO calls) and requires a valid config.

## Suggested Harness Test Strategy

Start with unit tests around pure utilities:

- `maskSensitiveData`
- `filterReviewableFiles`
- `selectReviewFocuses`
- finding content-hash generation and correlation

Then test workflow steps with mocked runtime context and mocked clients:

- `fetch-pr-details` should call `getPullRequestById`.
- `open-code-review-scanner` should pass the resolved native rule file unchanged, include selected focus reasons in the background, and map OCR comments to normalized findings.
- `OpenCodeReviewRunner` should map unknown string comment categories to `other` while rejecting structurally malformed comments.
- `scanner-pipeline` should preserve graceful degradation, propagate incomplete OCR status, correlate by content hash, persist stable finding IDs, and present actionable blocking/important/advisory category sections with selected focuses.
- `pr-review-workflow` should retain workspace-selected focuses in its incomplete fallback when scanner execution throws.
- `sonarqube-measures` should return `null` on missing client or fetch errors.
- `comment-review-results` should select valid code locations, suppress repeated and previously linked content hashes, order blocking and higher-severity findings first, apply the 30-comment cap last, link created ADO threads to persisted findings, and update the latest-review PR property.
- `FeedbackService` should synchronize only threads explicitly associated with each finding.
- `record-audit` should persist only allowlisted pilot metrics and must discard secret-like or arbitrary OCR metadata.
- `/api/audit` should export routed outcome metrics before any focus/status UI filters are added.

Do not use real ADO or SonarQube clients in automated tests.

## Evaluation Harness

The evaluation data model lives in `src/evaluation/type.ts`.

Current fixture format:

```json
{
  "id": "tc-java-001",
  "input": {
    "codeChange": {
      "changes": "...",
      "newFilePath": "src/Example.java",
      "oldFilePath": "src/Example.java",
      "changeType": "MODIFY"
    }
  },
  "expectedOutput": {
    "issues": [
      {
        "file": "src/Example.java",
        "line": 4,
        "message": "...",
        "suggestion": "...",
        "suggestion_code": "..."
      }
    ]
  }
}
```

A complete evaluation harness should:

1. Load each fixture from `src/evaluation/dataset`.
2. Run only the review path against `input.codeChange`, not the full PR-commenting workflow.
3. Normalize actual issues to the test schema.
4. Fuzzy-match issue file and line against expected issues.
5. Use `codeReviewEvaluationJudgeAgent` only for evaluation; it is not part of production review.
6. Emit metrics matching `codeChangesReviewEvaluationResultSchema`.

## OpenCodeReview Harness

The harness should verify the native rule file is valid JSON and passed unchanged
to `ocr review --rule`. Review-focus routing is deterministic: `general` always
applies, while changed code may also select `tests`, `error-handling`,
`type-design`, or `comments`. The selections and reasons are injected into OCR
background context and returned in scanner metadata; they do not cause extra LLM
calls.

## Live Run Checklist

Before allowing live PR review:

- Run `ratan-code-review start --pr-id <test-pr-id>` to scaffold a valid config and verify connectivity against a dedicated test PR first.
- Confirm the target repositories and PR age window in root config.
- Confirm `ADO_TOKEN`, the token referenced by `config.openCodeReview.llm.token`, and optional `SONARQUBE_TOKEN` are scoped correctly.
- Confirm the configured OpenCodeReview model endpoint is running and compatible with the selected provider mode.
- Confirm `.ratan/opencodereview/rule.json` is valid native OCR rule JSON.
- Confirm OCR rule scope and merge-policy configuration.
- Run against a dedicated test PR before enabling broad scanning.

Current status: local build and test checks pass. The scanner pipeline, OpenCodeReview runner and focus router, FindingStore finding/thread associations, feedback synchronization, webhook receiver, merge gate, work-item creation, and dashboard are implemented. Do not claim end-to-end ADO review operation until a target repository is configured and a dedicated live test PR review has been completed.

The Phase 3 live pilot is side-effectful. Require explicit authorization, a
bounded repository/PR cohort, and scoped credentials before running it. Do not
make focus-retention, confidence-threshold, or blocking-policy decisions until
the pilot report has been reviewed.

## Recommended Improvements

- [DONE] Move production model URL, token, model, and provider mode to `config.openCodeReview.llm`, with `env:` references for secrets.
- [DONE] Add focused Vitest coverage for OCR configuration, focus routing, persistence, and workflow integration.
- Implement `src/evaluation/scorer.ts` and `startupEvaluation`.
- Align `pr-review-workflow` output schema with the `comment-review-results` step.
- Log inline comment failures with enough context to debug without exposing secrets.
- Add dry-run mode so the full workflow can execute without writing PR comments.
- Add webhook server graceful shutdown and restart recovery.
- Add dashboard authentication/authorization.
