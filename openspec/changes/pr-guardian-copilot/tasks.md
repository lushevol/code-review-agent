## 1. Data Model — Normalized Finding Schema

- [x] 1.1 Define `NormalizedFinding` Zod schema in `src/mastra/types/finding.ts` with fields: id, prId, repository, filePath, lineStart, lineEnd, category, severity, confidence, title, description, evidence, businessImpact, remediation, blocking, linkedTaskId, resolution, sourceEngine, sourceVersion, supersedesFindingId, contentHash, createdAt, resolvedAt
- [x] 1.2 Define `FindingCategory` enum (bug, security, compliance, cve, dependency, quality)
- [x] 1.3 Define `FindingSeverity` enum (critical, high, medium, low, informational)
- [x] 1.4 Define `FindingResolution` enum (open, resolved, superseded, waived, false-positive, accepted-risk)
- [x] 1.5 Define `ScannerResult` type wrapping an array of NormalizedFinding plus scanner metadata (engine, version, durationMs)
- [x] 1.6 Add `FindingFeedback` schema for per-finding feedback (feedbackType, userId, comment, timestamp)
- [x] 1.7 Add `AuditRecord` schema for review audit trail
- [x] 1.8 Add `computeContentHash()` helper using SHA-256 for content-addressable finding identity

## 2. Finding Store — Persistence Layer

- [x] 2.1 Define `FindingStore` interface (init, upsertFinding, batchUpsert, getFindingsByPr, getFindingById, updateResolution, getFindingsByContentHash, saveAuditRecord, queryAuditRecords, close)
- [x] 2.2 Implement SQLite `FindingStore` using better-sqlite3 for pilot deployments (in `packages/finding-store/`)
- [x] 2.3 Implement in-memory `MemoryFindingStore` for testing in `packages/finding-store/src/memory-store.ts`
- [x] 2.4 Implement finding identity hash function using content-context SHA-256 `(filePath, surroundingLines) -> string`

## 3. Scanner Pipeline Architecture

- [x] 3.1 Define `Scanner` interface: `scan(context: ScanContext): Promise<ScannerResult>` in `scanners/types.ts`
- [x] 3.2 Create `ScanContext` type with pr details, code diffs, repo context, config, finding store
- [x] 3.3 Create `ScannerPipeline` step that runs scanners in parallel via Promise.allSettled and aggregates results
- [x] 3.4 Create `FindingCorrelator` — deduplicates findings across scanners by contentHash, merges overlapping findings, assigns blocking status (integrated into scanner-pipeline.ts)
- [x] 3.5 Create `FindingPrioritizer` — sorts findings by severity×confidence, caps at max findings (integrated into scanner-pipeline.ts)
- [x] 3.6 Wire scanner pipeline into `pr-review-workflow.ts`: fetchPR → fetchAdoContext → scannerPipeline → parallel(codeSummary, sonarqubeMeasures) → mergeGate → createWorkItems → comment

## 4. Existing AI Review — Migration to New Schema

- [x] 4.1 Create `AiReviewScanner` that wraps existing codeReviewAgent, rescore, and classification agents to output NormalizedFinding
- [x] 4.2 Add backward compatibility in `comment.ts` step — supports both old CodeReviewIssue and new NormalizedFinding comment posting
- [x] 4.3 Inject `workItemContext` from ADO work items into AI review prompt
- [x] 4.4 Keep existing `CodeReviewIssueSchema` for backward compatibility during transition

## 5. CVE / Dependency Scanner

- [x] 5.1 Create `CveScanner` class implementing the `Scanner` interface in `scanners/cve-scanner.ts`
- [x] 5.2 Integrate with SonarQube Issues API via `SonarQubeClient.searchIssues()` — search VULNERABILITY and SECURITY_HOTSPOT types
- [x] 5.3 Add `searchIssues()` method to `SonarQubeClient` in `packages/ratan-sonarqube-api/src/client.ts`
- [x] 5.4 Define `SonarIssue` and `SonarIssueSearchResult` interfaces
- [x] 5.5 Filter CVE results to only include files changed in the PR diff
- [x] 5.6 Add unit tests with mock SonarQube responses (12 tests)

## 6. Secret Scanner

- [ ] ~~6.1-6.6 Secret scanner~~ **REMOVED** — Per design decision, no dedicated secret scanner. Existing `maskSensitiveData()` continues for diff redaction only.

## 7. Compliance Rule Engine

- [x] 7.1 Create `ComplianceEngine` class implementing the `Scanner` interface in `scanners/compliance-engine.ts`
- [x] 7.2 Define rule file format (YAML schema) with rule-id, description, severity, file_pattern, forbidden patterns
- [x] 7.3 Implement rule loader — reads `.ratan/code-review-agent/rules/*.yaml` from local filesystem
- [x] 7.4 Implement rule evaluator — for each changed file matching file_pattern, check changed lines against forbidden patterns
- [x] 7.5 Implement built-in checks: TODO/FIXME detection, large-file (>400 lines) detection, console.log/stderr detection
- [x] 7.6 Add unit tests with sample rule files (14 tests)

## 8. Work Item Creation

- [x] 8.1 Create `create-workitems.ts` Mastra step using `ratan-ado-api` WIT client
- [x] 8.2 Implement logic: Critical → Bug work item type, High → Task, others → skip
- [x] 8.3 Format work item title as `[PR Guardian] <finding title> (PR #<prId>)`
- [x] 8.4 Populate work item description with full finding details and PR link
- [x] 8.5 Add artifact link from work item to ADO pull request
- [x] 8.6 Implement idempotency check — skip if work item already exists (via linkedTaskId in FindingStore)
- [x] 8.7 Store `linkedTaskId` back on the finding in FindingStore
- [x] 8.8 Add retry logic with exponential backoff for ADO API rate limits (in `src/mastra/utils/retry.ts`, 7 tests)
- [x] 8.9 Unit tests: retry (7), CVE (12), compliance (14), schema (27), eligibility (10) = 70+ new tests

## 9. Merge Governance — PR Status Reporting

- [x] 9.1 Create `merge-gate.ts` Mastra step — evaluates whether PR can be merged based on findings and active overrides
- [x] 9.2 Implement ADO PR Status API via `createPullRequestStatus()` in new `packages/ratan-ado-api/src/pull-request-status.ts`
- [x] 9.3 Set status to `failed` when unresolved blocking findings exist
- [x] 9.4 Set status to `succeeded` when no blocking findings
- [x] 9.5 Set status to `pending` when review is in progress for latest commit
- [x] 9.6 Implement stale-status cleanup — commit/iteration info in status context name

## 10. Re-review and Finding Lifecycle

- [x] 10.1 Create `FindingReconciler` — compares old and new findings by contentHash
- [x] 10.2 Implement resolution logic: old → resolved (gone), old → superseded (new version exists), new → open (first time)
- [x] 10.3 Add a "Changes since last review" section to updated PR comments (in `comment.ts`)
- [x] 10.4 Ensure re-review cancels in-flight review for same PR when new commit arrives (via `ReviewTracker` in `review-tracker.ts`)

## 11. Exception / Override Workflow

- [x] 11.1 Create `OverrideService` — manages finding resolution changes (waive, false-positive, accepted-risk) in `services/override-service.ts`
- [x] 11.2 Implement override authorization check — requires authorized user, two-person approval for Critical
- [x] 11.3 Implement override expiry — revert to `open` when expiry date passes
- [x] 11.4 Implement override renewal — extend expiry before it lapses
- [x] 11.5 Expose override API endpoints via dashboard PATCH `/api/findings/:id`

## 12. False-Positive Feedback

- [x] 12.1 Create `FeedbackService` — stores per-finding feedback with type and optional comment in `services/feedback-service.ts`
- [x] 12.2 Integrate feedback survey into PR review inline comments
- [x] 12.3 Implement FP rate calculation — count of false-positive / total feedback
- [x] 12.4 Implement per-source-engine accuracy reporting
- [x] 12.5 Implement high-FP-rule alerting (configurable threshold, default 30%)

## 13. Audit Trail

- [x] 13.1 Create `AuditService` — writes append-only audit records on review completion in `services/audit-service.ts`
- [x] 13.2 Populate audit record with all required fields: review ID, PR ID, commits, timestamps, scanners, model version, findings, decisions
- [x] 13.3 Ensure immutability via `audit_records` table — reject modifications to existing records
- [x] 13.4 Implement query API via FindingStore and dashboard `/api/audit` endpoint
- [x] 13.5 Implement configurable retention policy via `audit.retentionDays` config field

## 14. Analytics Dashboard

- [x] 14.1 Create dashboard backend service (Express REST API in `src/cli/dashboard/index.ts`)
- [x] 14.2 Implement REST endpoints: GET /api/findings, GET /api/audit, GET /api/stats, GET /api/health
- [x] 14.3 Build React frontend with Recharts charts (Vite + React SPA with 4 pages)
- [x] 14.4 Implement risk metrics page: summary cards, severity bar chart, category pie chart, recent activity
- [x] 14.5 Implement PRs page: PR table with finding counts
- [x] 14.6 Implement Findings page: filterable table with expandable details and override modal
- [x] 14.7 Implement Admin page: FP rates, override log, high-FP alerts
- [x] 14.8 Serve dashboard via new `dashboard` CLI command

## 15. PR Event Detection

- [x] 15.1 Create lightweight Express webhook receiver in `src/webhooks/index.ts`
- [x] 15.2 Handle `pullrequest.created` and `pullrequest.updated` event types
- [x] 15.3 Validate event payload — check repository is in pilot list, PR is not draft
- [x] 15.4 Enqueue review job — trigger Mastra workflow asynchronously
- [x] 15.5 Implement duplicate detection — dedup map with 5-min window in webhook handler
- [x] 15.6 Keep polling fallback — update existing `--watch` mode; webhook auto-registration in `scan --mode=service`
- [x] 15.7 Add eligibility gate — skip non-pilot repos, draft PRs, PRs below minimum size threshold

## 16. Configuration Updates

- [x] 16.1 Extend config schema in `agent-config-manager/src/types.ts` to support scanner settings, severity thresholds, merge policy, rule paths, webhook, dashboard
- [x] 16.2 Add `cveScanner` config section: enabled, sonarqubeProjectKey (using SonarQube, not Grype/Trivy)
- [ ] ~~16.3 Add `secretScanner` config section~~ **N/A** — secret scanner removed
- [x] 16.4 Add `complianceRules` config section: rules path, enable built-in checks
- [x] 16.5 Add `mergePolicy` config section: severity blocking defaults, override auth rules
- [x] 16.6 Add `remediationTasks` config section: enable/disable
- [x] 16.7 Add `audit` config section: retention period
- [x] 16.8 Add `dashboard` config section: enabled, port
- [x] 16.9 Add `webhook` config section: enabled, port, secret validation

## 17. CLI and Command Updates

- [x] 17.1 Update `scan` command to support `--mode=service` flag with FindingStore + webhook initialization
- [x] 17.2 Add `dashboard` CLI command to serve dashboard API
- [x] 17.3 Add `override` CLI command — list, create, revoke overrides
- [x] 17.4 Add `feedback` CLI command — export, stats

## 18. Integration and E2E Testing

- [x] 18.1 Write integration test for scanner pipeline — mock all scanners, verify correlation and prioritization
- [x] 18.2 Write integration test for work item creation flow (with mocked ADO API)
- [x] 18.3 Write integration test for merge governance — verify PR status is set correctly
- [x] 18.4 Write integration test for re-review — push new commit, verify findings reconciled
- [x] 18.5 Write integration test for exception workflow — override finding, verify merge allows
- [x] 18.6 Write E2E test for full review pipeline with real ADO PR (pilot environment)

## 19. PR Context from Commit Messages (NEW)

- [x] 19.1 Create `commit-parser.ts` — extract ADO work item IDs from commit messages
- [x] 19.2 Create `fetch-workitem-context.ts` Mastra step — fetch work item description, acceptance criteria, comments
- [x] 19.3 Inject work item context into AI review agent prompt in `code-review.ts`
- [x] 19.4 Thread workItemContext through `locate-changes.ts` and `pr-review-issues-workflow.ts`

## 20. External API Extensions (NEW)

- [x] 20.1 Add `createSubscription()` and `deleteSubscription()` to ADO notification API
- [x] 20.2 Add `createPullRequestStatus()` to ADO API (`packages/ratan-ado-api/src/pull-request-status.ts`)
- [x] 20.3 Add `searchIssues()` to SonarQubeClient for CVE scanning

## 21. Feedback Daemon (NEW)

- [x] 21.1 Create `FeedbackDaemon` class in `src/cli/commands/feedback-daemon.ts`
- [x] 21.2 Implement collection cycle — polls open findings with linked ADO threads
- [x] 21.3 Implement FP analysis report generation
- [x] 21.4 Wire `--feedback-daemon` flag into scan CLI command
