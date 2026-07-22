# PR Review Toolkit analysis: optimization opportunities for PR Guardian

Date: 2026-07-12

## Scope and conclusion

This note compares the official Anthropic `pr-review-toolkit` plugin with this
repository's core PR review path. The upstream plugin is a prompt-only,
developer-invoked review toolkit; PR Guardian is an Azure DevOps-integrated,
persisted, policy-enforcing review service. The useful lesson is therefore its
**diff-aware specialization and review rubrics**, not a replacement of the
existing scanner, privacy, persistence, or merge-governance architecture.

## What the upstream toolkit does

The plugin provides six specialist agents: general code review, test coverage,
error handling, type design, comment accuracy, and simplification. Its single
`review-pr` command obtains the changed-file scope, selects only applicable
specialists (with general review always applicable), supports sequential or
parallel execution, then aggregates results into critical, important,
suggestion, and strength buckets with a re-review action plan.

- [Plugin manifest](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/pr-review-toolkit/.claude-plugin/plugin.json#L1-L8)
- [Toolkit overview and six agents](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/pr-review-toolkit/README.md#L7-L138)
- [Scope, applicability, execution, and aggregation command](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/pr-review-toolkit/commands/review-pr.md#L13-L88)

Notable specialist rubrics:

- The general reviewer checks local project guidance, reviews the diff by
  default, and reports only findings with confidence at least 80/100; it
  distinguishes critical (90--100) from important (80--89) and requires a
  location, rationale, and concrete fix. [Source](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/pr-review-toolkit/agents/code-reviewer.md#L19-L56)
- The test reviewer focuses on behavioral coverage, maps changed behavior to
  tests, considers existing coverage, and prioritizes negative, error, async,
  and integration paths. [Source](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/pr-review-toolkit/agents/pr-test-analyzer.md#L19-L78)
- The error reviewer explicitly examines catches, callbacks, fallbacks,
  defaults, suppressed errors, and retry exhaustion; its results explain hidden
  error types and user impact. [Source](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/pr-review-toolkit/agents/silent-failure-hunter.md#L20-L109)
- The type reviewer identifies invariants and rates encapsulation, invariant
  expression, usefulness, and enforcement. It prefers pragmatic compile-time
  guarantees and making illegal states unrepresentable. [Source](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/pr-review-toolkit/agents/type-design-analyzer.md#L18-L118)
- Comment and simplification passes are deliberately advisory: the former
  checks accuracy, rot, and value; the latter is constrained to touched code
  and behavior-preserving polish. [Comment source](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/pr-review-toolkit/agents/comment-analyzer.md#L21-L79), [simplification source](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/pr-review-toolkit/agents/code-simplifier.md#L43-L88)

## Comparison with the current core agent

PR Guardian already has the harder operational foundations: it creates an
isolated merge-base/head workspace, runs OpenCodeReview plus optional CVE and
compliance scanners through `Promise.allSettled`, normalizes/deduplicates and
persists results, then posts comments and sets a merge-gate status.

- [Workflow orchestration](../../agents/ratan-code-review-agent/src/review/workflows/pr-review-workflow.ts)
- [Concurrent scanner pipeline, correlation, persistence, and review status](../../agents/ratan-code-review-agent/src/review/workflows/scanners/scanner-pipeline.ts)
- [OpenCodeReview conversion and PR/work-item context](../../agents/ratan-code-review-agent/src/review/workflows/scanners/open-code-review-scanner.ts)
- [Normalized finding contract and stable content hash](../../agents/ratan-code-review-agent/src/review/types/finding.ts)
- [Merge decision and ADO status](../../agents/ratan-code-review-agent/src/review/workflows/steps/merge-gate.ts)

The main gap is not scanner concurrency; it is **semantic routing and
specialist evidence**. Current OpenCodeReview findings retain a category and
severity, but do not expose a comparable confidence threshold, review lens, or
specialist-specific rubric. The pipeline currently runs OpenCodeReview for all
PRs and determines optional scanner applicability only by configuration, not
by changed-code characteristics. The final summary is primarily counts and
execution metadata rather than a consistent critical/important/advisory
decision-oriented report.

## Proposed optimization plan

### 1. Establish a measurable baseline

1. Collect a representative set of completed PRs and label findings by
   usefulness, duplicate rate, and false-positive reason.
2. Record per-engine execution duration, files reviewed, finding count,
   confidence (when available), and feedback outcome in the existing audit and
   finding stores.
3. Set success criteria before changing prompts: improved accepted-finding
   rate and test-gap detection, no material loss in security coverage, and no
   merge-gate regression.

This avoids optimizing the apparent quality of prompts without measuring the
review outcome.

### 2. Add a small diff-aware applicability router

Introduce a pure, unit-tested classifier that consumes the existing
`ReviewWorkspace.changes` and selects review lenses:

| Changed-code signal | Lens | Default outcome |
| --- | --- | --- |
| Any eligible code change | General | blocking-capable |
| Production logic without matching behavioral tests | Tests | advisory initially |
| `catch`, retry, fallback, or error-boundary changes | Errors | blocking-capable only after baseline |
| Added or materially changed exported/domain types | Types | advisory |
| Added or changed comments/docs | Comments | advisory |
| No unresolved critical/important findings | Simplification | advisory, post-gate |

The router should be conservative: an uncertain classification runs the
general lens rather than silently skipping review. It should be config-driven
only where policy genuinely differs by repository; do not add a general rules
language for six fixed lenses.

### 3. Introduce four narrow review lenses beside the general OCR scan

Add test, error-handling, type-design, and comment-accuracy scanners using the
upstream rubrics as prompt requirements. Each scanner should receive only the
changed files plus the minimal neighboring code and relevant project rules.
This keeps context and cost bounded, while the existing workspace already gives
them a reliable merge-base/head diff.

The general lens should adopt an explicit high-confidence gate. Map the
upstream 80/100 threshold to the existing `NormalizedFinding.confidence` field
(for example `0.80`), and make the threshold configurable per lens. Findings
below threshold should be kept in telemetry, not posted inline or considered
by the merge gate, until evidence shows they are useful.

### 4. Preserve one finding contract and improve aggregation

Extend scanner metadata—not the persistent finding identity—to include:

- `reviewLens` (`general`, `tests`, `errors`, `types`, `comments`);
- confidence and the lens threshold used;
- concise evidence of the changed behavior or code pattern inspected; and
- an advisory/blocking eligibility flag derived from policy.

Continue to use content-hash reconciliation, but merge same-location findings
across lenses into one postable issue with the individual lens evidence
attached. Present results as **blocking**, **important**, **advisory**, and
**strengths/coverage evidence**, rather than severity counts alone. This is an
aggregation change, not a second persistence model.

### 5. Roll out by policy tier and re-review behavior

1. Ship router plus lens telemetry behind disabled-by-default configuration.
2. Enable test, type, and comment lenses as advisory only; enable the error
   lens advisory-first as well.
3. Evaluate labeled PRs and reviewer feedback; promote only demonstrated,
   high-confidence error/general rules to merge-gate eligibility.
4. On a new PR iteration, re-run only lenses whose triggering files or
   content hashes changed, while preserving normal finding reconciliation.
5. Keep simplification strictly advisory and post-gate. It should suggest
   changes; it must not modify PR code or affect merge status.

## Risks and guardrails

- Do not treat upstream severity scales as directly comparable. Normalize every
  lens into the current `NormalizedFinding` policy before merge-gate use.
- Avoid independent comments from multiple lenses for the same line; aggregate
  first, then apply the existing inline-comment cap.
- Explicitly distinguish scanner failure/incomplete review from "no findings";
  the current pending merge decision for incomplete OpenCodeReview remains the
  correct safety boundary.
- The comment step presently suppresses individual inline-comment failures.
  The error lens should review product code, not create a circular policy that
  turns this operational behavior into an unprioritized scanner finding. Any
  change to that behavior needs a separate reliability decision.

## Recommended first implementation slice

Implement only the diff-aware router, the advisory test-coverage lens, and
the normalized confidence/metadata path. Verify it with router unit tests,
scanner-pipeline integration tests, and a small labeled PR evaluation set.
That validates the architecture with low merge-gate risk before adding error,
type, and documentation lenses.
