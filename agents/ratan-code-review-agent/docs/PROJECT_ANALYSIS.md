# Project Analysis

## Summary

`ratan-code-review` (PR Guardian Copilot) automates Azure DevOps pull-request
governance. It prepares an isolated merge-base/head workspace, runs
OpenCodeReview plus optional CVE and compliance scanners, correlates and persists
findings, evaluates merge policy, creates configured remediation work items, and
posts review results back to Azure DevOps. A React dashboard exposes findings,
history, overrides, and queue state.

OpenCodeReview is the sole production LLM review engine. PR Guardian owns
orchestration, configuration resolution, integrations, persistence, feedback,
and governance. The removed review/rescore/classify agent chain is not a runtime
fallback.

## Primary Capabilities

- Scans configured Azure DevOps repositories or a specific PR.
- Fetches PR and linked work-item context.
- Checks out an isolated local workspace at the PR merge base and head.
- Runs scanners concurrently with `Promise.allSettled`:
  - OpenCodeReview with native OCR rules and deterministic review-focus routing.
  - Optional SonarQube vulnerability and security-hotspot scanning.
  - Optional static compliance checks and YAML policy rules.
- Correlates findings by content hash and persists stable finding IDs in SQLite.
- Records selected OCR focuses (`general`, `tests`, `error-handling`,
  `type-design`, and `comments`) and their reasons in scanner metadata.
- Sets Azure DevOps PR status from merge policy; incomplete OCR runs remain
  pending for manual review.
- Presents correlated findings in blocking, important, and advisory category sections with concise details and selected OCR focuses.
- Posts up to 30 valid-location inline findings after blocking/severity ordering, content-hash duplicate suppression, and filtering of previously linked ADO threads.
- Links each created inline ADO thread to its persisted finding so feedback is
  synchronized only to the represented finding.
- Records audits, supports overrides, creates configured work items, and exposes
  a dashboard and webhook receiver.
- Records allowlisted pilot observability in audit raw outputs and exports it
  through the existing audit API without persisting arbitrary model metadata.

## Runtime Workflow

```text
fetch-pr-details
  -> fetch-workitem-context
  -> isolated merge-base/head workspace
  -> scanner-pipeline
       -> OpenCodeReview
       -> optional CVE scanner
       -> optional compliance engine
       -> correlate, prioritize, persist
  -> sonarqube-measures
  -> merge-gate
  -> record-audit
  -> create-workitems
  -> comment-review-results
       -> prioritized postable inline ADO threads
       -> finding_comment_threads associations
       -> main summary and latest-review property
```

Scanner failures degrade independently. An OpenCodeReview failure or incomplete
result marks the review execution incomplete, which makes the merge decision
pending rather than silently approving the PR.

## Core Data Contracts

`NormalizedFinding` is the common scanner output. Its important fields are:

```ts
{
  id: string;
  prId: number;
  repository: string;
  filePath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  category: string;
  severity: "critical" | "high" | "medium" | "low" | "informational";
  title: string;
  description: string;
  evidence: string;
  remediation: string;
  blocking: boolean;
  resolution: "open" | "resolved" | "superseded" | "waived" |
    "false-positive" | "accepted-risk";
  sourceEngine: "open-code-review" | "sonarqube-cve" | "compliance";
  sourceVersion: string;
  contentHash: string;
}
```

Finding identity across PR iterations is content-addressed. The
`finding_comment_threads` table separately associates repository, PR, finding,
and ADO thread IDs; this avoids treating every comment on a PR as feedback for
every finding.

Inline postability is a presentation decision only: a finding needs a non-empty
file path and positive line number. Current-run correlation and persisted
finding/thread associations prevent repeat inline threads across re-reviews.
Postability, ordering, duplicate suppression, and the comment cap do not remove
findings from persistence, audit, work-item, or merge-gate inputs.

OpenCodeReview does not expose calibrated confidence in the current output
contract. PR Guardian must not invent confidence values or restore the obsolete
confidence-rescore/filter chain without a separately approved design.

## Configuration

On first `start`, the CLI scaffolds:

```text
.ratan/
  config.json
  opencodereview/rule.json
  data/
  logs/
```

The wrapper configuration contains Azure DevOps connection settings and a root
`config` object. Production review settings live under:

```json
{
  "config": {
    "openCodeReview": {
      "workspaceRoot": ".ratan/workspaces",
      "rulesPath": "opencodereview/rule.json",
      "llm": {
        "url": "https://llm.example.com/v1",
        "token": "env:OCR_LLM_TOKEN",
        "model": "review-model",
        "useAnthropic": false
      }
    }
  }
}
```

`env:NAME` values are resolved recursively. Production review does not fall back
to `OPENAI_BASE_URL` or `OPENAI_API_KEY`. OpenCodeReview receives the native rule
file unchanged through `ocr review --rule`.

Other root settings control repository selection, finding-store path, logging,
retry behavior, scanner enablement, SonarQube, watch/feedback intervals, merge
policy, work-item remediation, audit, webhook, and dashboard behavior.

## Source Structure

```text
src/
  bootstrap/                         startup and PR scan loop
  cli/                               start/dashboard commands and config loader
  evaluation/                        evaluation schemas, fixtures, and judge
  review/
    open-code-review/                isolated OCR runner and focus router
    workspace/                       local merge-base/head workspace
    workflows/
      pr-review-workflow.ts          top-level orchestration
      scanners/                      OCR, CVE, compliance, correlation/persistence
      steps/                         fetch, gate, audit, work items, comments
      services/                      audit, feedback, overrides
      utils/                         reconciliation and review tracking
    types/                           workflow and finding contracts
  webhooks/                          ADO receiver and eligibility gate
dashboard/                           React SPA
```

The remaining code under `src/review/agents/` supports evaluation and is not the
production PR-review engine.

## Verification State

- `pnpm test` passes with 181 tests.
- `pnpm build` passes.
- Tests cover OCR configuration and native rule pass-through, focus routing,
  scanner integration, finding/thread persistence, feedback synchronization,
  comment linkage, CLI configuration, and supporting scanners/utilities.
- No live PR scan should be claimed from local verification alone; a configured
  target repository and dedicated test PR are still required.
- The first routed-review attempt on `example-repo` PR `#4` was incomplete and
  exposed an OCR category-contract mismatch. The adapter fix is locally
  verified; a successful live cohort and post-pilot policy decision remain
  pending because the corrected external-LLM retry was blocked.

## Risks And Gaps

- Live commands can post ADO comments, statuses, properties, and work items; they
  require explicit intent and correctly scoped credentials.
- Per-line comment-post failures are skipped so the main review can still post.
- SQLite is appropriate for the current single-runtime store; horizontal scaling
  would require an explicit persistence design.
- The dashboard needs deployment-level authentication and authorization.
- Feedback-derived prompt/rule recommendations remain human-reviewed.
- Evaluation scaffolding exists, but the full evaluation loop is incomplete.
