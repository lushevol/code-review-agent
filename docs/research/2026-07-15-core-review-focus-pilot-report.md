# Core Review Focus Pilot Report

**Status:** Pending live-pilot authorization and target cohort
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

Not collected. Local tests and builds do not constitute a live pilot.

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
changes until live results are available and this report is reviewed.
