# PR Guardian Copilot: CLI Workflow Guide

## The one-minute story

PR Guardian is an Azure DevOps review orchestrator. It prepares a safe temporary review workspace, runs OpenCodeReview plus optional security and compliance scanners, turns their output into durable findings, then posts a merge decision and concise PR feedback.

```text
PR trigger / CLI command
  -> PR context
  -> safe workspace
  -> parallel scanners
  -> findings + audit
  -> merge status + comments
```

Key points for a presentation:

- OpenCodeReview is the production AI reviewer. SonarQube CVE and local compliance checks are optional supporting scanners.
- The system degrades safely: a failed optional scanner does not stop the review. An incomplete OpenCodeReview run becomes `pending`, requiring manual review.
- Every review is tied to a commit, persisted in SQLite, and reconciled with prior findings so comments do not multiply after each update.
- There are two primary operating modes: review one specified PR, or discover and queue eligible PRs across repositories.

## 1. CLI entry points and options

| Command / option | What it does | Important branch |
| --- | --- | --- |
| `ratan-code-review --help` / `--version` | Shows usage or the package version and exits. | No configuration or network call. |
| `start` | Creates or repairs `.ratan`, loads configuration, connects to ADO, scans once, waits for the queue, then exits. | Automatic reviews require a detected build pipeline. |
| `start --pr-id <id>` | Reviews exactly one PR and waits for the workflow result. | Bypasses scan discovery and the automatic build-pipeline gate. |
| `start --watch` | Runs an immediate scan, repeats on the configured interval (30 minutes by default), and starts feedback synchronization. | If the LLM health check fails, that scan cycle is skipped. |
| `start --config <path>` | Uses another `.ratan` configuration directory. | Useful for separate environments or demos. |
| `start --repo-pattern <glob...>` | Restricts automatic discovery to matching repository names. | Overrides configured `scanRepoNames` for that run. |
| `dashboard --port <n>` | Starts the local PR Guardian dashboard. | Uses the configured port or `3099` by default. |
| `dashboard --finding-store <path>` | Uses a specified findings database. | Useful for inspecting a demo database. |

### Startup behavior before any review

1. Resolve the configuration directory (default: `.ratan`) and scaffold missing folders, default config, and OpenCodeReview rule file.
2. On an interactive first run, prompt for unresolved placeholder values. Non-interactive runs do not prompt.
3. Load config, configure logs and retention, then connect to Azure DevOps. A failed ADO connection stops the command.
4. Warn about incomplete LLM, SonarQube, or ADO settings. Warnings do not themselves stop startup; later capabilities may be unavailable.

> Secrets can be referenced as `env:VARIABLE_NAME`. The production LLM endpoint, token, model, and protocol come from `config.openCodeReview.llm`.

## 2. Direct PR review: `start --pr-id 123`

Use this path for a demonstration or an operator-requested review. It is the clearest “one PR in, one decision out” path.

```text
start --pr-id 123
  -> register ConfigProvider
  -> ReviewTracker starts
  -> workflow streams steps
  -> ReviewTracker finishes
```

### Shared review workflow

| Stage | What happens | If it cannot complete |
| --- | --- | --- |
| 1. Fetch PR details | Gets PR metadata and attempts to obtain linked work-item IDs. | A core fetch failure fails the workflow. |
| 2. Build business context | Reads linked work items and IDs mentioned in commit messages; formats description, acceptance criteria, and comments for review context. | Commit or work-item lookup errors are non-fatal; context becomes empty or partial. |
| 3. Prepare workspace | Creates a disposable two-commit review repository from the PR base/head. Changed text is masked for secrets before AI review; source checkout is not modified. | Workspace/pipeline failure makes OCR incomplete; downstream decision is pending. |
| 4. Run scanners | Runs OCR and enabled CVE/compliance scanners concurrently. | Each scanner is isolated through `Promise.allSettled`. |
| 5. Consolidate and store | Deduplicates findings by content hash, prioritizes them, reconciles with prior runs, and saves to SQLite. | Persistence failure is logged; review can continue. |
| 6. Decide and publish | Fetches SonarQube measures, sets PR status, records audit, creates eligible work items, and updates PR threads. | Most publishing failures are non-fatal and logged. |

### Stale-review protection

If a newer review begins for the same PR while an earlier review is running, the older one is marked stale and stops publishing output. This prevents old findings from overwriting a newer commit review.

## 3. Scanner pipeline and finding lifecycle

```text
Workspace changes -> OCR (always) --------------------\
                   CVE (unless disabled) -------------+-> correlate -> prioritize -> persist
                   Compliance (only when enabled) -----/
```

| Scanner | Enabled when | What it contributes | Failure behavior |
| --- | --- | --- | --- |
| OpenCodeReview | Always included. | AI code-diff review using native rules and selected focuses such as tests, error handling, type design, and comments. | If rejected or incomplete, the whole review becomes incomplete. |
| CVE / SonarQube | Enabled unless `scannerSettings.cve.enabled` is explicitly `false`. | SonarQube vulnerability and security-hotspot findings. | Failure is isolated; other scanners continue. |
| Compliance | Only when `scannerSettings.compliance.enabled` is `true`. | Local checks such as TODO/FIXME, `console.log`, large files, and YAML rules. | Failure is isolated; other scanners continue. |

### How raw results become useful findings

1. Collect successful scanner results and record OCR execution status and metadata.
2. Merge duplicate evidence using a content hash built from file location and surrounding code. The highest severity survives; evidence is combined.
3. Sort by severity and keep at most `maxPrioritizedFindings` findings (100 by default).
4. On later PR iterations, reconcile findings: retain matching issues, create new ones, mark disappeared findings resolved, and supersede changed findings. Incomplete OCR runs preserve prior state rather than claiming issues are resolved.
5. Record limits and suppression reasons in audit metadata. Inline comments require a valid file and line location, exclude already linked findings, deduplicate again, and cap comments at 30 by default.

> A clean “merge allowed” result is possible only after OpenCodeReview completes. If OCR fails or is incomplete, the merge decision is `pending` even when other scanners return no issues.

## 4. Decisions, PR output, and follow-up actions

### Merge-gate decision tree

```text
Was OpenCodeReview complete?
  No  -> PENDING: ADO status Pending; manual review required
  Yes -> Any open finding marked blocking?
           Yes -> BLOCKED: ADO status Failed; “Changes requested”
           No  -> ALLOWED: ADO status Succeeded; “No blocking issues”
```

| Outcome | ADO status | Canonical summary | Meaning |
| --- | --- | --- | --- |
| `pending` | Pending | Review incomplete | Automation did not finish; a human must decide. |
| `blocked` | Failed | Changes requested | One or more open blocking findings remain. |
| `allowed` | Succeeded | No blocking issues | OCR completed and no open blocking finding remains. |

### What gets posted to Azure DevOps

- A PR status named `PR Guardian / Merge Gate`, including the reviewed commit hint. Status publication failure does not erase the computed decision.
- Inline code threads for eligible new findings, ordered by blocking/severity and formatted with priority, severity, concise title, explanation, and an optional fenced suggested fix.
- Existing linked inline threads are refreshed rather than duplicated. Resolved finding threads are marked Fixed.
- Exactly one canonical PR-level conclusion is created as the newest thread; previous agent conclusions are deleted. It includes the decision, compact SonarQube metrics, and reviewed commit.
- A PR property records the latest reviewed source commit.

### Persistence, audit, and remediation work items

- SQLite stores findings, thread links, overrides, and audit records. Audit records include selected review focuses, OCR status/duration, reviewed-file count, suppression counts, and the merge decision.
- Critical open findings create an Azure DevOps Bug; high open findings create a Task. Existing linked work items are skipped for idempotency.
- Work-item creation/linking failures do not block review publication.

## 5. Automatic scan mode

Default `start` mode runs one discovery pass. Watch mode repeats that pass and synchronizes developer feedback.

```text
Discover repositories
  -> filter by CLI globs or configured names
  -> find recent open PRs
  -> validate
  -> skip already-commented
  -> queue
  -> build check
  -> shared review workflow
```

| Automatic-scan branch | Rule / behavior | Result |
| --- | --- | --- |
| Repository list | Fetched from ADO and cached for 24 hours. | Less repeated ADO traffic. |
| Repository filter | CLI `--repo-pattern` values win; otherwise use configured `scanRepoNames`; with neither, scan all repos. | Only matching repositories are considered. |
| PR discovery | Looks for open PRs created in the last seven days. | Older PRs are outside this scan window. |
| PR validity | ADO client rejects invalid PRs. | Invalid PRs are skipped. |
| Already reviewed | Lightweight PR details are checked for existing agent comments. | Previously commented PRs are skipped. |
| Queue processing | Before review, detect a build pipeline for the PR. | No build pipeline: log and skip. |
| Watch health check | Before each scan cycle, request the configured LLM endpoint with a five-second timeout. | Unhealthy endpoint: skip that cycle and try again next interval. |

### Watch-only feedback daemon

After a 30-second startup delay, the daemon runs at its configured interval (15 minutes by default) unless disabled. It reads audited PRs from SQLite, checks their ADO comment-thread states, and updates finding resolution/dismissal/false-positive signals. Per-PR failures do not stop the next PR or cycle.

> For a predictable live presentation, use `start --pr-id` with a prepared test PR. Scan and watch modes can create ADO statuses, comments, and work items.

## 6. PR event / webhook path

Webhook support is a service path beside the public CLI commands. It can call the same review handler when Azure DevOps emits pull-request events.

```text
ADO git.pullrequest.created or .updated
  -> POST /webhooks/ado
  -> parse JSON
  -> optional HMAC check
  -> deduplicate for 5 minutes
  -> accept immediately
  -> background review handler
```

| Webhook branch | Behavior |
| --- | --- |
| Invalid JSON | Returns HTTP 400. |
| Webhook secret configured | Requires `x-hub-signature`; an invalid or missing signature returns HTTP 401. |
| Non-PR event | Returns `{ ignored: true }`. |
| Missing PR ID or repository | Returns HTTP 400. |
| Duplicate PR + commit within 5 minutes | Returns a successful skipped response; no new review is triggered. |
| Accepted event | Returns HTTP 200 immediately; review runs fire-and-forget, so handler errors are logged asynchronously. |
| Subscription registration | When `WEBHOOK_PUBLIC_URL` and ADO subscription support are available, the service attempts to register created and updated events; otherwise polling remains the fallback. |

### Optional pilot eligibility gate

The webhook package also exposes a pilot eligibility check: the repository must be in the pilot list, the PR must not be a draft, and there must be code changes. It is a reusable gate; the small webhook receiver delegates to its supplied handler and does not itself call that gate.

## Suggested three-minute demo narration

1. “I start with one PR. The CLI loads its config, connects to Azure DevOps, and prepares a clean temporary review workspace without modifying the checkout.”
2. “The agent enriches the diff with work-item context, masks sensitive text, and runs the AI reviewer plus any enabled security and compliance scanners in parallel.”
3. “It turns overlapping scanner output into stable, stored findings. On a later push, it refreshes the same threads and resolves ones that disappeared instead of spamming new comments.”
4. “The merge gate is deliberately simple: incomplete AI review means pending; blocking open findings mean blocked; otherwise allowed.”
5. “For operations, scan mode finds recent PRs across configured repositories and queues only those that pass the automation gates. Watch mode adds recurring scans and feedback sync.”

> Running a real direct review, scan, watch mode, or webhook handler can create external Azure DevOps statuses, comments, work items, and subscriptions. Use a demo PR and scoped credentials.
