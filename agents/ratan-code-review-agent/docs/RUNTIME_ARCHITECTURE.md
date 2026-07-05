# Runtime Architecture

## Component View (v2 — PR Guardian Copilot)

```mermaid
flowchart TD
    Webhook["ADO Webhook:<br/>git.pullrequest.created/updated"] --> Eligibility["Eligibility Gate:<br/>pilot repo, draft, min size"]
    Eligibility --> Dedup["Dedup Window: 5 min"]
    Dedup --> WorkflowRun["Mastra prReviewWorkflow run"]

    Polling["Polling: scan --watch<br/>every 30 min"] --> PRScan["scanPRs(runtimeContext)"]
    PRScan --> ADOList["ADO: repos and PR list"]
    PRScan --> WorkflowRun

    WorkflowRun --> FetchPR["fetch-pr-details"]
    FetchPR --> ADOFetch["ADO: PR details, diffs, iteration"]
    FetchPR --> FetchWIC["fetch-workitem-context"]
    FetchWIC --> ADOWI["ADO: extract work item IDs<br/>from commits, fetch AC"]

    FetchWIC --> Scanners["scanner-pipeline"]
    Scanners --> AIReview["ai-review-scanner<br/>LLM code review"]
    Scanners --> CVE["cve-scanner<br/>SonarQube Issues API"]
    Scanners --> Compliance["compliance-engine<br/>static analysis + YAML rules"]
    AIReview --> Correlate["Correlation & Dedup<br/>content-hash matching"]
    CVE --> Correlate
    Compliance --> Correlate
    Correlate --> Persist["Persist to FindingStore<br/>(SQLite)"]

    Persist --> Para["Parallel (Mastra step)"]
    Para --> Summary["code-summary<br/>LLM PR summary"]
    Para --> Sonar["sonarqube-measures<br/>quality gate metrics"]

    Summary --> MergeGate["merge-gate"]
    Sonar --> MergeGate
    MergeGate --> ADOStatus["ADO: set PR status<br/>(succeeded/failed/pending)"]

    MergeGate --> WorkItems["create-workitems"]
    WorkItems --> ADOWI2["ADO: create Bug (critical)<br/>and Task (high)"]

    WorkItems --> Comment["comment-review-results"]
    Comment --> ADOWrite["ADO: inline comments,<br/>main comment, PR properties"]
```

## Legacy Workflow (pre-v2, still present as sub-workflow)

```mermaid
flowchart TD
    Locate["locate-pr-changes"] --> Review["code-review"]
    Review --> Filter1["filter-issues (confidence >= 0.8)"]
    Filter1 --> Rescore["code-review-rescore"]
    Rescore --> Filter2["filter-issues"]
    Filter2 --> Classify["code-review-issue-classification"]
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

`scanPRs` returns an RxJS `Observable` of pending pull requests. For every pending PR, `runScanLoop` creates a Mastra workflow run, sets `configSessionId` in `RuntimeContext`, streams the workflow, and logs every full-stream output.

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

1. **AI Review Scanner**: Code diff review via LLM → rescore confidence → classify by category → map to `NormalizedFinding` with content hash.
2. **CVE Scanner**: Queries SonarQube Issues API for `VULNERABILITY` and `SECURITY_HOTSPOT` types → map to `NormalizedFinding`.
3. **Compliance Engine**: Static analysis rules:
   - Pattern scan: TODO/FIXME/HACK/XXX comments
   - console.log / debugger detection
   - Large file detection (configurable threshold)
   - YAML policy-as-code rules (configurable)

All scanner results are collected, correlated by scanner engine, deduplicated by content hash (SHA-256 of `filePath + surrounding code`), and persisted to the `FindingStore` SQLite database.

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

## Work Item Creation Flow

1. Collect findings with severity = Critical (→ Bug) or High (→ Task).
2. Skip if work item creation is disabled in config.
3. Create ADO work items via `adoClient.createWorkItem`.
4. Link work items to PR via artifact link.
5. Errors are non-fatal; workflow continues.

## Comment Flow

`comment-review-results`:

1. Reads classified review issues, summary text, and SonarQube measures.
2. Reads original PR details from the `fetch-pr-details` step result.
3. Reconciles with previous review findings (content-hash matching) for re-review.
4. Posts up to 30 inline code comments, in reverse order.
5. Posts the main PR review comment with approval status, errors, summary, and SonarQube measures.
6. Stores the latest reviewed iteration id in PR properties under `CODE_REVIEW_AGENT_LATEST_REVIEW_ID`.
7. Returns `mainCommentId` and `codeCommentIds`.

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
6. Trigger `prReviewWorkflow` via Mastra.

## Data Privacy Flow

Diff text passes through `maskSensitiveData`, which uses `redact-pii` credential redaction plus custom patterns for Stripe-style keys, bearer tokens, and assignments to `password`, `token`, or `secret`.

The current masking configuration intentionally does not redact email addresses, names, phone numbers, IP addresses, URLs, generic digits, or street addresses.
