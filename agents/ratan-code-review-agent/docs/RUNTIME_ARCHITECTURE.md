# Runtime Architecture

## Component View (v2 — PR Guardian Copilot)

```mermaid
flowchart TD
    Webhook["ADO Webhook:<br/>git.pullrequest.created/updated"] --> Eligibility["Eligibility Gate:<br/>pilot repo, draft, min size"]
    Eligibility --> Dedup["Dedup Window: 5 min"]
    Dedup --> WorkflowRun["runPrReviewWorkflow"]

    Polling["Polling: scan --watch<br/>every 30 min"] --> PRScan["scanPRs(runtimeContext)"]
    PRScan --> ADOList["ADO: repos and PR list"]
    PRScan --> WorkflowRun

    WorkflowRun --> FetchPR["fetch-pr-details"]
    FetchPR --> ADOFetch["ADO: PR details, diffs, iteration"]
    FetchPR --> FetchWIC["fetch-workitem-context"]
    FetchWIC --> ADOWI["ADO: extract work item IDs<br/>from commits, fetch AC"]

    FetchWIC --> Scanners["scanner-pipeline"]
    Scanners --> AIReview["open-code-review-scanner<br/>focused OCR review"]
    Scanners --> CVE["cve-scanner<br/>SonarQube Issues API"]
    Scanners --> Compliance["compliance-engine<br/>static analysis + YAML rules"]
    AIReview --> Correlate["Correlation & Dedup<br/>content-hash matching"]
    CVE --> Correlate
    Compliance --> Correlate
    Correlate --> Persist["Persist to FindingStore<br/>(SQLite)"]
    Persist --> Sonar["sonarqube-measures<br/>quality gate metrics"]

    Sonar --> MergeGate["merge-gate"]
    MergeGate --> ADOStatus["ADO: set PR status<br/>(succeeded/failed/pending)"]

    MergeGate --> WorkItems["create-workitems"]
    WorkItems --> ADOWI2["ADO: create Bug (critical)<br/>and Task (high)"]

    WorkItems --> Comment["comment-review-results"]
    Comment --> ADOWrite["ADO: inline comments,<br/>finding/thread links, main comment,<br/>PR properties"]
```

## Startup Flow

Two entry points exist:

**1. `startup(startupOptions)`** (backwards compat for demo.ts, evaluation)
Accepts `AgentConfigCreationOptions`. Creates a config session via `AgentConfigSession.createAgentConfigSession()`, then calls `runScanLoop()`.

**2. `startScanWithProvider(provider)`** (used by CLI)
Accepts a pre-created `ConfigProvider`. Registers it via `AgentConfigSession.registerProvider()`, then calls `runScanLoop()`.

Both converge on `runScanLoop(agentConfig: ConfigProvider)`, which calls `scanPRs` with:

```ts
{
  runtimeContext: {
    configSessionId: agentConfig.id
  }
}
```

`scanPRs` returns an RxJS `Observable` of pending pull requests. For every pending PR, `runScanLoop` creates a local `RequestContext`, sets `configSessionId`, streams `runPrReviewWorkflow`, and logs every step output.

## PR Scan Flow

`scanPRs`:

1. Reads `scanRepoNames` and `scanPRCreatedDaysAgo` from root config.
2. Gets repositories from the ADO client (cached for 24 hours via module-level cache).
3. Applies repository name glob patterns through `minimatch`.
4. Fetches active PRs created within the configured time window.
5. Skips PRs without ids.
6. Uses `adoClient.isValidPullRequest`.
7. Fetches PR details with comments.
8. Skips PRs where the agent has already commented.
9. Emits `{ repoName, prId }`.

## Scanner Pipeline Flow

The scanner pipeline runs all scanners concurrently via `Promise.allSettled`:

1. **OpenCodeReview Scanner**: Select deterministic focuses from changed files, run OpenCodeReview once with PR/work-item context and native OCR rules, then map comments to `NormalizedFinding` objects. OpenCodeReview owns review semantics; PR Guardian does not rescore or invent confidence.
2. **CVE Scanner**: Queries SonarQube Issues API for `VULNERABILITY` and `SECURITY_HOTSPOT` types → map to `NormalizedFinding`.
3. **Compliance Engine**: Static analysis rules:
   - Pattern scan: TODO/FIXME/HACK/XXX comments
   - console.log / debugger detection
   - Large file detection (configurable threshold)
   - YAML policy-as-code rules (configurable)

All scanner results are collected, correlated by scanner engine, deduplicated by content hash (SHA-256 of `filePath + surrounding code`), and persisted to the `FindingStore` SQLite database. OCR metadata records the selected focuses and their reasons. The correlation summary presents blocking, important, and advisory sections grouped by category with concise finding details; these are display buckets and do not change stored severity or merge-gate inputs.

Fallback dedup: location-based matching `(filePath, lineStart +/- 3, sourceEngine, category)`.

## Merge Gate Flow

After all findings are collected and persisted:

1. Read merge policy from root config (severity/category thresholds).
2. Evaluate blocking findings against policy.
3. Set ADO PR Status via `adoClient.createPullRequestStatus`:
   - `succeeded` — no blocking findings
   - `failed` — blocking findings exist
   - `pending` — review in progress
4. Errors are non-fatal; workflow continues.

## Audit Observability Flow

`record-audit` persists an allowlisted pilot payload in
`audit_records.raw_scanner_outputs`: selected focuses and routing reasons, OCR
status and warning types, duration, reviewed-file count, postable finding count,
duplicate-suppression counts, inline-suppression counts, and review execution
status. Arbitrary scanner metadata and model credentials are not copied. The
existing `/api/audit` endpoint exports the stored payload; the dashboard does
not add focus/status filters until operator consumption justifies them.
Unknown string categories in OCR comments are normalized to `other`. If a
failure escapes the scanner pipeline after workspace routing, the workflow
fallback retains the focuses already selected for that workspace.

## Work Item Creation Flow

1. Collect findings with severity = Critical (→ Bug) or High (→ Task).
2. Skip if work item creation is disabled in config.
3. Create ADO work items via `adoClient.createWorkItem`.
4. Link work items to PR via artifact link.
5. Errors are non-fatal; workflow continues.

## Comment Flow

`comment-review-results`:

1. Reads normalized scanner findings, the deterministic review summary, and SonarQube measures.
2. Reads original PR details from the `fetch-pr-details` step result.
3. Reconciles with previous review findings (content-hash matching) for re-review.
4. Selects inline-postable findings with a valid file and positive line, removes findings already associated with an ADO thread, orders by blocking status and severity, suppresses repeated content hashes, then applies the 30-comment cap.
5. Posts the main PR review comment with the consolidated category/focus summary and SonarQube measures.
6. Stores the latest reviewed iteration id in PR properties under `CODE_REVIEW_AGENT_LATEST_REVIEW_ID`.
7. Links each created ADO inline thread to its persisted finding in `finding_comment_threads`.
8. Returns `mainCommentId` and `codeCommentIds`.

The feedback daemon uses these associations to apply thread reactions or status changes only to the represented finding; it does not apply every PR thread to every finding.

### Re-review Reconciliation

`reconcileFindings()` compares previous findings (same PR, latest reviewed iteration) vs current findings:
- **findingsToCreate** — truly new (no content hash match)
- **findingsToSupersede** — existing finding with updated details
- **findingsToResolve** — finding that disappeared → auto-close
- **findingsToKeep** — active overrides preserved

## Webhook Flow

1. ADO sends `git.pullrequest.created` or `git.pullrequest.updated` event to `POST /webhooks/ado`.
2. HMAC-SHA256 signature validation against configured webhook secret.
3. Extract `resource.repository.id`, `resource.pullRequestId`.
4. Check dedup window (5 min) — skip if recently processed.
5. Check eligibility gate — pilot repo, draft status, min size.
6. Trigger `runPrReviewWorkflow`.

## Data Privacy Flow

Diff text passes through `maskSensitiveData`, which uses `redact-pii` credential redaction plus custom patterns for Stripe-style keys, bearer tokens, and assignments to `password`, `token`, or `secret`.

The current masking configuration intentionally does not redact email addresses, names, phone numbers, IP addresses, URLs, generic digits, or street addresses.
