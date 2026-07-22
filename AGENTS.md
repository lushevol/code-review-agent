# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Behavioral Guidelines

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

### 5. Post-Code-Change Documentation Hook (Mandatory)

**Every code change must trigger a documentation impact check before handoff or commit.**

After changing code:

1. Run `git diff --name-only` and map each changed area to its user-facing or maintainer-facing documentation.
2. Update every affected document in the same change. Do not defer documentation updates to a later task.
3. Search for stale names, commands, configuration keys, workflow steps, and architecture descriptions with `rg`.
4. Verify documented commands against `package.json` scripts and documented paths against the repository.
5. In the final report, list the documents updated. If no document required a content change, state why.

Documentation triggers:

| Code change | Required documentation check |
|-------------|------------------------------|
| Runtime flow, scanner, workflow step, persistence, or integration behavior | `README.md`, `AGENTS.md`, and `agents/ratan-code-review-agent/docs/RUNTIME_ARCHITECTURE.md` |
| CLI command, option, scaffolding, or operational behavior | `README.md`, `AGENTS.md`, and `agents/ratan-code-review-agent/docs/AI_HARNESS.md` |
| Configuration schema, environment variable, template, or default | `README.md`, `AGENTS.md`, templates, and config/design docs |
| Public package API or package responsibility | `README.md` and the package-level documentation |
| Test/evaluation workflow or safety constraint | `AGENTS.md` and `agents/ratan-code-review-agent/docs/AI_HARNESS.md` |
| Accepted design or implementation-plan behavior | The corresponding file under `docs/superpowers/specs/` or `docs/superpowers/plans/` |

A code change is not complete while relevant documentation describes the old behavior.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Project Overview

This is a pnpm workspace monorepo (pnpm 9/11) containing **PR Guardian Copilot** — an AI-powered Azure DevOps pull request governance platform built with plain TypeScript orchestration. OpenCodeReview is the sole LLM review engine; PR Guardian owns workspace preparation, optional CVE/compliance scanning, correlation, persistence, ADO comments, feedback, and merge governance.

The system connects to Azure DevOps (ADO) for PR data, calls OpenAI-compatible LLMs for AI review, queries SonarQube for security vulnerabilities, enforces compliance rules, and posts review results as ADO PR comments and status checks.

Published as `ratan-code-review` on npm with a CLI binary providing `start` and `dashboard` commands.

## Package Structure

| Workspace | Location | Purpose |
|---------|----------|---------|
| `ratan-code-review` | `agents/ratan-code-review-agent` | Main review agent — TypeScript workflow runner, scanner pipeline, CLI, webhooks, dashboard backend, services |
| `finding-store` | `packages/finding-store` | SQLite-based persistence for findings, overrides, and audit records |
| `agent-config-manager` | `packages/agent-config-manager` | `ConfigProvider` interface, ADO config fetching/caching, LocalConfigClient |
| `ratan-ado-api` | `packages/ratan-ado-api` | Azure DevOps API client (PRs, repos, builds, work items, comments, status) |
| `ratan-markdown-tool` | `packages/ratan-markdown-tool` | Local JSON-to-Markdown builder and HTML-to-Markdown conversion |
| `ratan-sonarqube-api` | `packages/ratan-sonarqube-api` | SonarQube web API client for PR measures |

## Architecture

### Workflow

```
prReviewWorkflow(prId):
  fetch-pr-details                    — ADO: PR details, diffs, iteration metadata
  fetch-workitem-context              — ADO: extract work item IDs from commits, fetch descriptions/AC
  scanner-pipeline (parallel Promise.allSettled):
    ├── open-code-review-scanner     — focused OpenCodeReview run → NormalizedFinding
    ├── cve-scanner                  — SonarQube Issues API (VULNERABILITY, SECURITY_HOTSPOT)
    └── compliance-engine            — Static analysis: TODO/FIXME, console.log, large files, YAML rules
  correlation & dedup (content-hash)  — Merge all scanner findings, deduplicate by SHA-256 hash
  persist to FindingStore             — SQLite: findings, finding_comment_threads, overrides, audit
  sonarqube-measures                 — SonarQube quality gate metrics
  merge-gate                         — Evaluate blocking findings, set ADO PR status (succeeded/failed)
  create-workitems                   — Auto-create ADO Bug (critical severity) and Task (high severity)
  comment-review-results             — Prioritized inline comments + one newest concise conclusion
```

### Event Detection

```
ADO webhook (git.pullrequest.created / git.pullrequest.updated)
  → Express webhook receiver (HMAC-SHA256 validation)
  → Eligibility gate (pilot repo check, draft status, min size)
  → Dedup window (5 min)
  → Trigger prReviewWorkflow

Fallback: polling every 30 min via `start --watch`
	```

### Runtime Logging

`ratan-logger` emits concise component-scoped events. Pretty console lines contain
timestamp, level, component, event message, and flat scalar troubleshooting fields;
JSONL files use the same flat record shape. Nested objects and full array contents are
not logged: arrays contribute a count, and diagnostic arrays may add up to five types
and three bounded messages. This prevents workflow outputs and finding collections
from being duplicated at every step while retaining failure reasons. Secret-like
fields remain redacted, and error stacks are available only when
`config.logging.level` is `debug`.

The review bootstrap emits `review.started`, `review.step.completed`, `review.stale`,
`review.failed`, and `review.finished`; workspace/scanner fallback emits
`review.pipeline.failed`. Each event carries `prId`, plus `step`, `durationMs`,
`status`, `repo`, or `error` only when relevant. Incomplete scanner execution is
explicit on step and terminal events. Legacy bracket-prefixed console messages are
routed through the prefix as their source component until their call sites migrate.

### CLI Commands

The `ratan-code-review` CLI has two commands:

- **`start`** — Unified entry point. On first run, scaffolds `.ratan/` with default config and native OpenCodeReview rules. Reads config, initializes the PR queue, and starts the scan loop. Runs a background feedback daemon (ADO comment sync) automatically in `--watch` mode. Options: `--config <path>`, `--pr-id <id>` (runs the explicit review directly, waits for completion, surfaces failures, and bypasses the automatic-scan build-status gate), `--watch` (30-min interval + feedback daemon), `--repo-pattern <patterns...>`.
- **`dashboard`** — Starts the PR Guardian dashboard (Express REST API + React SPA). Serves `/api/health`, `/api/queue`, `/api/findings`, `/api/overrides`, `/api/audit`, `/api/stats`, `/api/prs`.
- **Root help** — `ratan-code-review --help` ends with a concise cheatsheet for first-run scanning, direct PR review, watch mode, and dashboard startup.

### Scanner Pipeline

The scanner pipeline runs all scanners concurrently via `Promise.allSettled` (graceful degradation — individual failures don't block the pipeline):

| Scanner | Engine | Source | Purpose |
|---------|--------|--------|---------|
| OpenCodeReview | `open-code-review` | `@alibaba-group/open-code-review` | Code diff review using native OCR rules and deterministic review-focus routing |
| CVE | `cve` | SonarQube Issues API | Vulnerability and security hotspot detection |
| Compliance | `compliance` | Static analysis + YAML rules | TODO/FIXME/HACK detection, console.log, large files, configurable rules |

Each scanner produces `NormalizedFinding` objects with a content hash (SHA-256 of `filePath + surrounding code`) for identity across PR iterations. Findings are correlated, deduplicated by content hash, and persisted to the `FindingStore`. Inline ADO thread IDs are linked back to persisted finding IDs so feedback synchronization updates only the finding represented by that thread.

The main PR comment contains only the merge decision, finding count, compact SonarQube coverage/new-bug/new-vulnerability/new-code-smell results, and reviewed commit. Each review posts the canonical conclusion last so it is the newest/top ADO thread, then deletes prior agent-generated conclusions. Inline notes use a Markdown heading with priority/severity and a concise escaped title, followed by the explanation and an optional suggested fix in a plain fenced code block. Inline eligibility requires a valid file/line location; postable findings are ordered by blocking status and severity, deduplicated by content hash, filtered against previously linked finding/thread associations, then capped at 30. Previously linked inline threads are refreshed in place. These presentation rules do not change merge-gate inputs.

Pilot observability is stored in `audit_records.raw_scanner_outputs` without a schema migration. The allowlisted payload contains review focuses/reasons, OCR status/warnings/duration/reviewed-file count, postable count, duplicate-suppression reasons, inline-suppression reasons, and execution status. Arbitrary OCR/config metadata is not persisted. The existing `/api/audit` endpoint exports this data; do not add focus/status UI controls until operators demonstrate a need.

OpenCodeReview string categories outside the local finding vocabulary are normalized to `other`; non-string malformed values still fail validation. If review execution fails after workspace focus selection, the incomplete audit fallback must retain those selected focuses and reasons.

### Config Provider

The `ConfigProvider` interface (in `agent-config-manager`) is implemented by:
- **`AgentConfigClient`** — Fetches configuration from ADO repos with caching
- **`LocalConfigClient`** — Reads configuration and resolves local rule paths

The wrapper config at `.ratan/config.json` declares the mode (`"local"` or `"ado"`) and mode-specific parameters. OpenCodeReview LLM settings live under `config.openCodeReview.llm`; its native rule file defaults to `.ratan/opencodereview/rule.json`. Secrets use `"env:VAR_NAME"` syntax, resolved at load time by the config loader.

### Review Engines
- **OpenCodeReview** — sole production LLM review engine; receives PR/work-item context, native OCR rules, and selected focuses (`general`, `tests`, `error-handling`, `type-design`, `comments`) in one review run.
- **LlmEvaluationJudge** — opt-in golden-evaluation judge using the configured OCR endpoint; its qualitative scores never alter deterministic evaluation pass/fail and it is not part of production PR review.

### Services

- **FindingStore** — SQLite persistence via `packages/finding-store`. Tables include `findings`, `finding_comment_threads`, `override_log`, and `audit_records`. Content-addressable finding identity uses SHA-256 hashes; ADO thread associations support finding-specific feedback. `MemoryFindingStore` is used in tests.
- **OverrideService** — Finding resolution override management. Workflows: waive, false-positive, risk-accept. Two-person approval for critical findings. Expiry management. Full audit trail.
- **FeedbackService** — Collects ADO comment reactions (👍/👎), aggregates false-positive patterns, generates prompt optimization recommendations (semi-automated, human review required).
- **AuditService** — Append-only audit records. Every review result captured with commit hash, engine versions, model version, and timestamp. Retention policy.
- **ReviewTracker** — Cancels stale in-flight workflow output when a newer review starts for the same PR. Finding reconciliation separately compares prior and current findings by content hash/location, persists create/supersede/resolve/keep transitions after complete reviews, and preserves prior state after incomplete reviews.

### Webhooks

An Express webhook receiver runs as part of the webhook service (separate from the `start` command):
- HMAC-SHA256 signature validation against configured webhook secret
- Dedup window (5 min) prevents duplicate processing
- Auto-registration of `git.pullrequest.created` and `git.pullrequest.updated` subscriptions via ADO notification API
- PR eligibility gate: pilot repo check, draft status check, minimum size check

### Dashboard

A React SPA (Vite + Recharts + React Router) served by an Express backend:
- **Dashboard Overview** — Charts: findings by severity, category, trend over time
- **Findings Explorer** — Filterable/sortable table of all findings (severity, category, engine, status)
- **PR Listing** — All reviewed PRs with status and summary
- **Admin** — Override management, PR queue management (manual add/cancel), service controls

### LLM Configuration

OpenCodeReview model configuration is read from `config.openCodeReview.llm` (`url`, `token`, `model`, and optional `protocol`). Values may use `env:VAR_NAME`; there is no production fallback to `OPENAI_BASE_URL` or `OPENAI_API_KEY`.

### Data Privacy
Before OpenCodeReview sees Git content, the runner creates a temporary two-commit repository and masks changed text via `maskSensitiveData()`. Credential replacements use per-run keyed markers so the LLM can still detect whether a secret changed without receiving the original value or a reusable hash. The source checkout is never modified.

### Config System
`agent-config-manager` provides the `ConfigProvider` interface. Two implementations:
- `AgentConfigClient` — fetches configuration from an ADO repo and caches it with a configurable TTL (default 5 min).
- `LocalConfigClient` — reads from the local filesystem via the config loader (`src/cli/config/loader.ts`) and resolves the OCR rule path relative to the config directory.

OpenCodeReview owns review semantics through its native rule JSON. Default config and rule templates shipped with the package live at `templates/` (published to npm). On first `start` run, the CLI copies them to `.ratan/` for editing.

## Key Files

### Core Agent
- `agents/ratan-code-review-agent/src/cli/index.ts` — CLI entry point (start, dashboard)
- `agents/ratan-code-review-agent/src/cli/commands/` — start, dashboard command implementations
- `agents/ratan-code-review-agent/src/cli/config/loader.ts` — config file reader with `"env:VAR_NAME"` token resolution
- `agents/ratan-code-review-agent/src/cli/config/local-client.ts` — `LocalConfigClient` implementation
- `agents/ratan-code-review-agent/src/cli/dashboard/` — Express dashboard backend (health, findings, audit, stats APIs)
- `agents/ratan-code-review-agent/bin/ratan-code-review.cjs` — npm bin shim (CJS entry)
- `agents/ratan-code-review-agent/bin/ratan-code-review.js` — npm bin shim (ESM entry)
- `agents/ratan-code-review-agent/src/review/index.ts` — review type exports; production review uses OpenCodeReview directly
- `agents/ratan-code-review-agent/src/review/open-code-review/` — OCR runner and deterministic review-focus router
- `agents/ratan-code-review-agent/src/review/workflows/pr-review-workflow.ts` — top-level workflow definition (scanner pipeline, merge gate, audit, work items, comments)
- `agents/ratan-code-review-agent/src/review/workflows/steps/` — fetch, SonarQube measures, merge-gate, audit, work-item, and comment steps
- `agents/ratan-code-review-agent/src/review/workflows/scanners/` — OpenCodeReview, CVE, and compliance scanners plus correlation/persistence pipeline
- `agents/ratan-code-review-agent/src/review/workflows/services/` — audit-service, feedback-service, override-service
- `agents/ratan-code-review-agent/src/review/workflows/utils/` — finding-reconciler, review-tracker
- `agents/ratan-code-review-agent/src/review/types/index.ts` — shared Zod schemas and TypeScript types
- `agents/ratan-code-review-agent/src/review/types/finding.ts` — NormalizedFinding schema, FindingCategory, FindingSeverity, EngineType, content hash computation
- `agents/ratan-code-review-agent/src/bootstrap/` — provider session registration and explicit PR review startup
- `agents/ratan-code-review-agent/src/webhooks/` — Express webhook receiver, HMAC validation, eligibility gate
- `agents/ratan-code-review-agent/src/evaluation/` — 25-case synthetic golden PR corpus, deterministic evaluator, opt-in live OCR runner, and optional qualitative LLM judge
- `agents/ratan-code-review-agent/templates/` — default config and native OCR rule templates (published to npm)

### Dashboard (React SPA)
- `agents/ratan-code-review-agent/dashboard/` — Vite + React + Recharts SPA (DashboardOverview, FindingsPage, PRsPage, AdminPage)

### Packages
- `packages/finding-store/src/index.ts` — `FindingStore` class with SQLite persistence (findings, overrides, audit)
- `packages/finding-store/src/memory-store.ts` — `MemoryFindingStore` for tests
- `packages/agent-config-manager/src/config.ts` — `AgentConfigClient` class for ADO config fetching/caching
- `packages/agent-config-manager/src/types.ts` — `ConfigProvider` interface, config schema definitions
- `packages/agent-config-manager/src/session.ts` — `AgentConfigSession` with `registerProvider()`
- `packages/ratan-ado-api/src/client.ts` — `AzureDevOps` class, ~40 methods for ADO API
- `packages/ratan-sonarqube-api/src/client.ts` — `SonarQubeClient`

## Commands

```bash
# Install dependencies (pnpm 9+)
pnpm install

# Build all packages
pnpm build

# Build a specific package
pnpm agent:build
pnpm --filter agent-config-manager build

# Run tests
pnpm test

# Run a single test file
pnpm --filter ratan-code-review exec vitest run src/cli/config/local-client.spec.ts

# Run package coverage (offline)
pnpm --filter ratan-code-review test:coverage

# Validate the synthetic golden corpus without external calls
pnpm --filter ratan-code-review evaluate:golden --dry-run

# Evaluate one synthetic PR against the configured OCR endpoint (external call)
pnpm --filter ratan-code-review evaluate:golden --case ts-sql-injection

# CLI usage (after build)
node agents/ratan-code-review-agent/bin/ratan-code-review.cjs --help
node agents/ratan-code-review-agent/bin/ratan-code-review.cjs start
node agents/ratan-code-review-agent/bin/ratan-code-review.cjs start --watch
node agents/ratan-code-review-agent/bin/ratan-code-review.cjs start --pr-id 12345
node agents/ratan-code-review-agent/bin/ratan-code-review.cjs dashboard

# Verify published package, installed CLI, environment, and ADO access (read-only)
pnpm verify:release -- --pr-id 12345

# Run the same checks and then a side-effecting real PR review
pnpm verify:release -- --scan-pr 12345 --expect-decision blocked

# Also require a fenced suggested-fix code block
pnpm verify:release -- --pr-id 12345 --expect-decision blocked --expect-fenced-suggestion

# Run watch mode (starts PR scanning — has side effects)
pnpm agent:dev

```

## Environment

```bash
# Required
ADO_TOKEN=your_azure_devops_pat

# LLM credentials are normally referenced from config.openCodeReview.llm
# Example: "token": "env:OCR_LLM_TOKEN"
OCR_LLM_TOKEN=your_api_key

# Optional
SONARQUBE_TOKEN=your_sonarqube_token
```

## Important Notes

- `pnpm dev` / `pnpm agent:dev` create real external side effects (ADO calls, PR comments). Do not run without user confirmation.
- `ADO_TOKEN` env var is required for Azure DevOps access.
- Production LLM endpoint, token, model, and provider mode are owned by `config.openCodeReview.llm`; `env:` references are resolved recursively.
- Workspace dependencies: `finding-store`, `agent-config-manager`, `ratan-ado-api`, `ratan-sonarqube-api` — defined in other packages in the monorepo.
- The `start` CLI command scaffolds `.ratan/` from `templates/` on first run, then reads config via `ConfigProvider` and runs the scan loop.
- The scanner pipeline uses `Promise.allSettled` for graceful degradation — individual scanner failures don't block the pipeline.
- Merge gate sets ADO PR Status (`succeeded`/`failed`) based on policy. Errors are non-fatal.
- Work item creation step handles errors and null/missing ADO work-item responses gracefully (non-fatal).
- Comment step posts at most 30 valid-location findings after blocking/severity ordering and current-run deduplication. It refreshes linked inline threads, marks resolved-finding threads Fixed, renders suggested fixes in fenced code blocks, posts one concise canonical conclusion last, deletes prior agent-generated conclusion threads, and silently skips per-line creation failures. The conclusion is rendered directly from the merge decision, so a blocked result cannot be presented as approval.
- OpenCodeReview output does not expose a calibrated confidence score; do not restore the obsolete confidence-rescore/filter path or invent confidence values.
- The test suite covers CLI config/scaffolding and repository overrides, configured LLM health checks, OpenCodeReview configuration and focus routing, a 25-case multilingual synthetic PR finding corpus plus optional judge parsing, merge-gate decisions, work-item creation/context, SonarQube degradation, finding/thread persistence, feedback synchronization, scanners, dashboard APIs, workflow integration, pre-Git-diff sensitive-data masking, retry logic, and eligibility gates.
- `evaluate:golden --dry-run` is offline. Running it without `--dry-run` requires at least one explicit `--case` and sends only selected synthetic fixtures to `config.openCodeReview.llm`; it does not fetch ADO data or post PR comments. Require explicit authorization before evaluating non-synthetic or private code against an external endpoint.
- Golden fixtures currently model only added and modified files. Treat skipped or errored OCR execution as evaluation failure; do not count an empty clean-case result as a successful review unless OCR completed.
- A live pilot can post ADO comments and statuses. Do not run the Phase 3 pilot without explicit user authorization, a target cohort, and scoped credentials; do not change merge policy before the pilot report is reviewed.
- The 2026-07-15 `example-repo` PR `#4` attempt is incomplete, not a successful pilot: it exposed an OCR category-contract mismatch, and the corrected live retry was blocked by the environment's external-data policy.
- The 2026-07-20 published `ratan-code-review@0.1.8` package completed a two-iteration synthetic `example-repo` PR `#5` pilot: the vulnerable commit produced a critical linked inline finding, failed status, and canonical `Changes requested` summary; the parameterized-query follow-up marked the linked thread Fixed, posted succeeded status, and updated the same summary to `No blocking issues`. SonarQube result and reviewed commit remained visible. A pre-`0.1.8` unlinked inline thread required one-time manual cleanup.
- The 2026-07-20 published `ratan-code-review@0.1.9` package verified newest-conclusion replacement on fresh synthetic `example-repo` PR `#6`, but rendered inspection exposed literal bold markers in the model title and ADO's apply-suggestion widget. Published `0.1.10` replaced that format with a bounded escaped heading and plain code fence. A real continuation fix commit parameterized the query; its review marked the linked thread Resolved, posted succeeded status, and created the sole allowed conclusion as the highest visible thread.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **code-review-agent** (2398 symbols, 4823 relationships, 159 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/code-review-agent/context` | Codebase overview, check index freshness |
| `gitnexus://repo/code-review-agent/clusters` | All functional areas |
| `gitnexus://repo/code-review-agent/processes` | All execution flows |
| `gitnexus://repo/code-review-agent/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
