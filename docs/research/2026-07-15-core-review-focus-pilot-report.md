# Core Review Focus Pilot Report

**Status:** Attempted; insufficient live results
**Policy status:** No merge-policy or confidence-threshold change approved

## Purpose

Evaluate whether deterministic OpenCodeReview focus guidance improves useful
review coverage without increasing false positives, duplicate comments,
incomplete reviews, or review duration enough to harm adoption.

## Preconditions

- Explicit authorization to run side-effectful ADO reviews.
- A bounded repository and PR cohort with representative production changes.
- Scoped ADO and model credentials.
- Phase 0 finding/thread linkage enabled so reviewer reactions and overrides map
  to the finding that produced each comment.
- No merge-policy changes during the pilot.

## Metrics

| Metric | Source | Comparison |
|--------|--------|------------|
| Reviewer positive/negative reaction | Finding feedback linked to ADO threads | Phase 0 baseline vs focused cohort |
| Override and false-positive rate | Finding resolutions and feedback reasons | Per focus and overall |
| Duplicate inline comments | Audit duplicate-suppression counts and thread links | Phase 0 vs focused cohort |
| Review duration | `ocrDurationMs` in audit raw outputs | Median and p95 |
| Incomplete status rate | `reviewExecutionStatus` and `ocrStatus` | Percentage of reviews |
| Postable finding yield | `postableFindingCount` | Per focus and changed-file count |

## Cohort Results

One isolated PR was created: `example-repo` PR `#4`, source branch
`codex/core-review-pilot-20260715131825`, targeting `main`. It adds only a
generated `review-pilot/sample.ts` file and is marked “Do not merge.”

The standard CLI skipped the PR because the repository has no build pipeline.
The directly invoked review workflow then recorded an incomplete audit
(`bd7095a8-206a-44bd-a240-f4ed3bf0cf7c`) and posted main comment `2`; it created
no findings, inline comments, or work items. Diagnosis against byte-identical,
Codex-authored synthetic content showed that OpenCodeReview can emit string
categories outside the adapter enum, causing the otherwise valid output to be
discarded. The adapter now maps unknown string categories to `other`, and the
outer workflow fallback retains focuses selected before failure.

The corrected live retry was not run because the execution environment blocked
exporting ADO repository content to the external DeepSeek endpoint. Synthetic
OCR completed successfully, but synthetic results and local tests do not
constitute a live cohort and provide no reviewer-reaction or override data.

## Required Post-Pilot Decisions

After the cohort is complete and reviewed, record:

1. Retain, revise, or remove each of `tests`, `error-handling`, `type-design`,
   and `comments`; `general` remains the baseline focus.
2. Decide whether `error-handling`, or a separately designed security focus,
   warrants a blocking-policy proposal. Do not change policy inside the pilot.
3. Confirm whether OpenCodeReview exposes calibrated confidence. Until it does,
   do not add a confidence threshold or manufacture confidence values.
4. If specialist coverage is still needed, propose it independently rather than
   restoring the removed review/rescore/classify agent chain.

## Current Decision

Defer all focus-retention, confidence, security-specialist, and blocking-policy
changes. This attempt is useful failure-path evidence but is insufficient for
any policy decision; a successful approved cohort in an environment permitted
to send the repository diff to its configured model is still required.
