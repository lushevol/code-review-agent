# Core Review Agent Optimization Plan

## Goal

Increase useful PR-review coverage without replacing OpenCodeReview or changing
the existing governance boundary: PR Guardian still owns ADO integration,
finding persistence, audit, comments, and merge policy; OpenCodeReview remains
the sole LLM review engine and native rule-file owner.

## Evidence and constraints

- The upstream PR Review Toolkit uses specialist rubrics for general review,
  test coverage, error handling, type design, comments, and simplification.
  Its transferable pattern is selective, diff-aware specialization, not its
  prompt-only agent architecture. See
  [the research note](../../research/2026-07-12-pr-review-toolkit-analysis.md).
- The current pipeline already runs OpenCodeReview with CVE and compliance
  scanners concurrently, normalizes findings, reconciles them, persists them,
  and drives the merge gate.
- `OcrCommentSchema` has no confidence signal. Do **not** implement an 80%
  confidence gate by inventing a confidence value. Add such a gate only if
  OpenCodeReview exposes calibrated confidence or a separately approved
  evidence-based evaluator is introduced.
- `ReviewWorkspace.changes` provides changed paths and added lines, which is
  sufficient for deterministic, unit-testable applicability routing.
- The OpenCodeReview configuration-ownership plan is a prerequisite. This
  plan assumes its `.ratan/config.json` and native
  `.ratan/opencodereview/rule.json` contract is complete.

## Non-goals

- Do not restore the obsolete review/rescore/classification agent stack.
- Do not add a second LLM provider, prompt directory, or parallel persistent
  finding model.
- Do not make test, type, comment, or simplification feedback merge-blocking
  in the initial rollout.
- Do not change the behavior of existing CVE, compliance, override, or ADO
  status integrations as part of the first slice.

## Success criteria

1. Every OCR review records the selected review focuses and their routing
   reasons in scanner/audit metadata.
2. The general review still runs for every eligible PR; uncertain routing never
   silently skips code review.
3. Each inline ADO thread is reliably linked to the finding that created it,
   so feedback and false-positive rates can be measured per review focus.
4. A pilot demonstrates higher reviewer-accepted findings per reviewed PR for
   routed reviews, with no increase in duplicate inline threads or failed
   review completion.
5. Merge-gate behavior is unchanged until a separately measured policy change
   is approved.

## Delivery sequence

### Phase 0 — make outcomes measurable and establish the baseline

**Depends on:** completion of
`docs/superpowers/plans/2026-07-12-opencodereview-config-ownership.md`.

**Files:**

- Modify: `packages/finding-store/src/index.ts`
- Modify: `packages/finding-store/src/memory-store.ts`
- Modify: `agents/ratan-code-review-agent/src/review/workflows/steps/comment.ts`
- Modify: `agents/ratan-code-review-agent/src/review/workflows/services/feedback-service.ts`
- Create: focused FindingStore, comment-step, and feedback-service tests

1. Add a `finding_comment_threads` SQLite association table with repository,
   PR ID, finding ID, ADO thread ID, and creation timestamp. Use a separate
   table rather than overloading `findings.linked_task_id`, which belongs to
   remediation work items. Mirror the association in `MemoryFindingStore`.
2. After an inline comment is created, persist its `findingId → threadId`
   association. The feedback daemon must synchronize only that linked thread;
   it must not infer a finding's resolution by scanning every PR thread. This
   linkage is required before calculating reviewer acceptance or false-positive
   rates.
3. Define the pilot before collecting its baseline: participating repositories,
   date range, minimum reviewed-PR count, and a pre-agreed improvement
   threshold for accepted findings. Choose these values with the operators;
   do not hard-code arbitrary universal defaults in the product.
4. Capture the selected historical/pilot PRs, their linked findings, feedback
   and overrides, review status, and scanner duration. Do not add audit schema
   migrations yet: `rawScannerOutputs` can retain the review metrics.
5. Define the measurement report: PR count, OCR completion rate, elapsed time,
   total and inline-posted findings, duplicate rate, overrides, and feedback
   outcome. Treat the report as a baseline, not a release gate.
6. Add a short operator document stating that advisory findings do not change
   merge decisions.

**Verification:** query existing `audit_records` and finding feedback for the
pilot sample; manually confirm every metric is computed from the linked ADO
thread rather than unrelated PR threads, without secrets or raw diff
persistence. Test that an ADO thread status only changes the resolution of its
linked finding.

### Phase 1 — route code changes and give OCR focused context

**Files:**

- Create: `agents/ratan-code-review-agent/src/review/open-code-review/review-focus-router.ts`
- Create: `agents/ratan-code-review-agent/src/review/open-code-review/review-focus-router.spec.ts`
- Modify: `agents/ratan-code-review-agent/src/review/workflows/scanners/open-code-review-scanner.ts`
- Modify: `agents/ratan-code-review-agent/src/review/workflows/scanners/types.ts`
- Modify: `agents/ratan-code-review-agent/src/review/workflows/scanners/open-code-review-scanner.spec.ts`
- Modify: `agents/ratan-code-review-agent/src/review/open-code-review/runner.spec.ts`
- Modify: `agents/ratan-code-review-agent/templates/opencodereview/rule.json.template`

1. Define a closed `ReviewFocus` union:
   `general | tests | error-handling | type-design | comments`. `general` is
   always selected. This is not an exhaustive taxonomy: an OCR security focus
   is an explicit post-pilot decision, informed by missed-issue evidence from
   the general OCR and CVE scanners.
2. Implement a pure router taking `ReviewWorkspace.changes`. It returns each
   selected focus with deterministic reasons derived from changed paths and
   added-line patterns:
   - test-like production changes without changed test paths → `tests`;
   - `catch`, retry, fallback/default, callback error, or error-boundary
     changes → `error-handling`;
   - exported TypeScript declarations and domain/model type changes →
     `type-design`;
   - changed doc/comment lines → `comments`;
3. Use conservative matching. A router match adds focus; absence of a match
   cannot suppress `general`. Keep patterns local and readable—there is no
   user-defined routing language in this phase.
4. Add a `## Review focus` section to the existing OCR background built by
   `buildBackground()`. It lists selected focuses and their concrete reasons,
   but does not introduce another model call.
5. Add concise review guidance to the native OCR rule template for each focus:
   behavioral test gaps, silent failure paths, type invariants, comment
   accuracy. Rules must require a changed-code location, a concrete
   failure/maintenance consequence, and a remediation for any reported issue.
6. Return the focus list and reasons as `OpenCodeReviewScanner` metadata; do
   not alter `NormalizedFinding`, its content hash, or engine type.
7. Preserve user ownership: existing native rule files are not rewritten.
   Publish the optional focus-guidance template and release-note migration
   instructions; do not place configuration advice in merge-gate comments.

**Verification:** runner tests prove the generated background reaches OCR and
the native rule file remains passed through unchanged. Scanner tests prove
focus reasons are bounded and do not expose resolved credentials. Table-driven
router tests cover each signal, deleted files, renames, no changes, mixed
changes, and the invariant that `general` is always present.

### Phase 2 — consolidate and order postable findings

**Implemented 2026-07-15:** inline postability now requires a valid code
location; postable findings are ordered by blocking status and severity,
deduplicated by content hash, filtered against persisted finding/thread links,
and capped at 30. The main review uses consolidated
blocking/important/advisory category sections with concise finding details and
selected review focuses. Persistence and merge-gate inputs remain unchanged.

**Files:**

- Create: `agents/ratan-code-review-agent/src/review/workflows/scanners/finding-eligibility.ts`
- Create: `agents/ratan-code-review-agent/src/review/workflows/scanners/finding-eligibility.spec.ts`
- Create: `agents/ratan-code-review-agent/src/review/workflows/scanners/finding-priority.ts`
- Modify: `agents/ratan-code-review-agent/src/review/workflows/scanners/scanner-pipeline.ts`
- Modify: `agents/ratan-code-review-agent/src/review/workflows/steps/comment.ts`
- Modify: `agents/ratan-code-review-agent/src/review/workflows/scanners/scanner-pipeline.integration.spec.ts`

1. Add a deterministic postability check after normalization. It should decide
   only whether a finding gets an inline thread, based on a valid code
   location and duplicate correlation. Do not repeat Zod's required-field
   validation, invent confidence, or change merge-gate inputs in this phase.
2. Replace the count-only correlation summary with a consolidated report:
   `blocking`, `important`, and `advisory` sections, grouped by category and
   including selected review focuses. Severity remains the source of truth;
   "important" is presentation only, not a new persistent severity.
3. Sort inline comments by blocking status and severity before applying the
   existing cap. Never emit duplicate comments for the same correlated finding.

**Verification:** pipeline integration tests cover incomplete OCR, duplicate
cross-scanner hashes, severity ordering, and unchanged CVE/compliance
behavior. Comment-step tests cover ordering, finding-to-thread linkage, and
the existing 30-comment limit.

### Phase 3 — observability, pilot, and policy decision

**Implementation status 2026-07-15:** local observability and audit API export
are implemented. Audit raw outputs use an explicit allowlist for focus/routing,
OCR execution, postability, and suppression metrics. No dashboard filter or
merge-policy change was added. The live ADO pilot and written post-pilot policy
decision remain pending explicit authorization and a bounded target cohort; see
`docs/research/2026-07-15-core-review-focus-pilot-report.md`.

**Files:**

- Modify: `agents/ratan-code-review-agent/src/review/workflows/scanners/scanner-pipeline.ts`
- Modify: `agents/ratan-code-review-agent/src/review/workflows/steps/record-audit.ts`
- Modify: `agents/ratan-code-review-agent/src/review/workflows/services/audit-service.spec.ts`
- Modify: `agents/ratan-code-review-agent/src/cli/dashboard/` (only the
  existing stats/audit endpoints and UI surfaces needed to display the metrics)

1. Record selected focuses, routing reasons, OCR status/warnings, duration,
   reviewed-file count, postable finding count, and duplicate-suppression
   reasons in `rawScannerOutputs`. This avoids an audit schema migration during
   the pilot.
2. Add dashboard/audit filters for focus and review status only if the
   information is actually consumed by operators; otherwise export it from the
   audit endpoint first.
3. Run a limited pilot with focus guidance enabled. Compare it to Phase 0 on
   reviewer reaction, override/false-positive rates, duplicate comments,
   review duration, and incomplete status rate.
4. Make a written policy decision after the pilot:
   - retain or remove each focus;
   - decide whether `error-handling` or a new security focus warrants a
     blocking policy proposal;
   - decide whether OpenCodeReview supports calibrated confidence. Only then
    consider a confidence threshold or independent specialist scanner.

**Verification:** audit tests assert focus data is persisted; dashboard/API
tests assert it is rendered without exposing secret configuration. The pilot
report records the success criteria above and must be reviewed before any
merge-policy change.

## Implementation order and commits

1. `feat: link inline review threads to findings`
2. `feat: route OCR review focuses from changed code`
3. `feat: summarize and order postable review findings`
4. `feat: audit routed review outcomes`

Before each code change, run the repository-mandated GitNexus upstream impact
analysis for every edited symbol and surface any HIGH or CRITICAL result.
Before each commit, run `gitnexus detect_changes()` plus the focused Vitest
tests for that slice; run the package typecheck and build before the final
commit.
