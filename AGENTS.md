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

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Project Overview

This is a pnpm workspace monorepo (pnpm 9/11) containing **PR Guardian Copilot** — an AI-powered Azure DevOps pull request governance platform built on the **Mastra** framework. It evolved from a basic code review agent into a full governance platform by adding a multi-scanner pipeline (AI review, CVE scanning, compliance checking), merge governance via ADO PR status, webhook-driven PR event detection, a React dashboard, SQLite-based finding persistence, and an audit trail with override management.

The system connects to Azure DevOps (ADO) for PR data, calls OpenAI-compatible LLMs for AI review, queries SonarQube for security vulnerabilities, enforces compliance rules, and posts review results as ADO PR comments and status checks.

Published as `ratan-code-review` on npm with a CLI binary providing `start` and `dashboard` commands.

## Package Structure

| Workspace | Location | Purpose |
|---------|----------|---------|
| `ratan-code-review` | `agents/ratan-code-review-agent` | Main Mastra-based agent — workflows, scanner pipeline, CLI, webhooks, dashboard backend, services |
| `finding-store` | `packages/finding-store` | SQLite-based persistence for findings, overrides, and audit records |
| `agent-config-manager` | `packages/agent-config-manager` | `ConfigProvider` interface, ADO config fetching/caching, LocalConfigClient |
| `ratan-ado-api` | `packages/ratan-ado-api` | Azure DevOps API client (PRs, repos, builds, work items, comments, status) |
| `ratan-code-review-agent-orm` | `packages/ratan-code-review-agent-orm` | Drizzle ORM helpers and PostgreSQL schema |
| `ratan-markdown-tool` | `packages/ratan-markdown-tool` | Markdown conversion utilities (html2md, json2md, markdown2html) |
| `ratan-sonarqube-api` | `packages/ratan-sonarqube-api` | SonarQube web API client for PR measures |

## Architecture

### Workflow (Mastra)

```
prReviewWorkflow(prId):
  fetch-pr-details                    — ADO: PR details, diffs, iteration metadata
  fetch-workitem-context              — ADO: extract work item IDs from commits, fetch descriptions/AC
  scanner-pipeline (parallel Promise.allSettled):
    ├── ai-review-scanner            — LLM code review → rescore → classify → NormalizedFinding
    ├── cve-scanner                  — SonarQube Issues API (VULNERABILITY, SECURITY_HOTSPOT)
    └── compliance-engine            — Static analysis: TODO/FIXME, console.log, large files, YAML rules
  correlation & dedup (content-hash)  — Merge all scanner findings, deduplicate by SHA-256 hash
  persist to FindingStore             — SQLite: findings, override_log, audit_records
  parallel (Mastra parallel step):
    ├── code-summary                 — LLM PR summary
    └── sonarqube-measures           — SonarQube quality gate metrics
  merge-gate                         — Evaluate blocking findings, set ADO PR status (succeeded/failed)
  create-workitems                   — Auto-create ADO Bug (critical severity) and Task (high severity)
  comment-review-results             — Post PR summary + inline comments + reconcile re-reviews
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

### CLI Commands

The `ratan-code-review` CLI has two commands:

- **`start`** — Unified entry point. On first run, scaffolds `.ratan/` folder with default config and prompts from template files. Reads config, initializes the PR queue, and starts the scan loop. Runs a background feedback daemon (ADO comment sync) automatically in `--watch` mode. Options: `--config <path>`, `--pr-id <id>`, `--watch` (30-min interval + feedback daemon), `--repo-pattern <patterns...>`.
- **`dashboard`** — Starts the PR Guardian dashboard (Express REST API + React SPA). Serves `/api/health`, `/api/queue`, `/api/findings`, `/api/audit`, `/api/stats`, `/api/prs`.

### Scanner Pipeline

The scanner pipeline runs all scanners concurrently via `Promise.allSettled` (graceful degradation — individual failures don't block the pipeline):

| Scanner | Engine | Source | Purpose |
|---------|--------|--------|---------|
| AI Review | `ai-review` | OpenAI-compatible LLM | Code diff review, confidence rescore, issue classification |
| CVE | `cve` | SonarQube Issues API | Vulnerability and security hotspot detection |
| Compliance | `compliance` | Static analysis + YAML rules | TODO/FIXME/HACK detection, console.log, large files, configurable rules |

Each scanner produces `NormalizedFinding` objects with a content hash (SHA-256 of `filePath + surrounding code`) for identity across PR iterations. Findings are correlated, deduplicated by content hash, and persisted to the `FindingStore`.

### Config Provider

The `ConfigProvider` interface (in `agent-config-manager`) is implemented by:
- **`AgentConfigClient`** — Fetches config/prompts from ADO repos with caching
- **`LocalConfigClient`** — Reads config JSON and prompt `.md` files from local filesystem

The wrapper config at `.ratan/code-review-agent/config.json` declares the mode (`"local"` or `"ado"`) and mode-specific parameters. Secrets use `"env:VAR_NAME"` syntax, resolved at load time by the config loader.

### Agents (registered in `src/mastra/index.ts`)
- **codeReviewAgent** — GPT-5-mini, reviews code diffs, returns issues with Zod schema
- **codeReviewRescoreAgent** — re-evaluates confidence scores
- **codeReviewIssueClassificationAgent** — categorizes issues
- **codeChangeSummaryAgent** — summarizes PR changes
- **codeReviewEvaluationJudgeAgent** — evaluation judge

### Services

- **FindingStore** — SQLite persistence via `packages/finding-store`. Tables: `findings`, `override_log`, `audit_records`. Content-addressable finding identity via SHA-256 hash. `MemoryFindingStore` variant for tests.
- **OverrideService** — Finding resolution override management. Workflows: waive, false-positive, risk-accept. Two-person approval for critical findings. Expiry management. Full audit trail.
- **FeedbackService** — Collects ADO comment reactions (👍/👎), aggregates false-positive patterns, generates prompt optimization recommendations (semi-automated, human review required).
- **AuditService** — Append-only audit records. Every review result captured with commit hash, engine versions, model version, and timestamp. Retention policy.
- **ReviewTracker** — Tracks reviewed iterations per PR. Compares previous vs new findings via content-hash matching, producing create/supersede/resolve/keep buckets.

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

Model endpoint reads from environment: `OPENAI_BASE_URL` and `OPENAI_API_KEY` (resolved in `src/mastra/agents/openai-client.ts`).

### Data Privacy
Diff text is masked via `maskSensitiveData()` using `redact-pii` (credentials only) and custom regex for Stripe keys, bearer tokens, and `password`/`token`/`secret` assignments.

### Config System
`agent-config-manager` provides the `ConfigProvider` interface. Two implementations:
- `AgentConfigClient` — fetches `config.json` and prompt markdown files from an ADO repo, caches with configurable TTL (default 5 min), resolves Handlebars templates.
- `LocalConfigClient` — reads from local filesystem via the config loader (`src/cli/config/loader.ts`), also supports Handlebars interpolation for path and content variables.

Prompt keys used: `review`, `review-rescore`, `issue-classification`, `summary`.

Default config and prompt templates shipped with the package live at `templates/` (published to npm). On first `start` run, the CLI copies these to `.ratan/` for editing.

## Key Files

### Core Agent
- `agents/ratan-code-review-agent/src/cli/index.ts` — CLI entry point with commander (start, dashboard)
- `agents/ratan-code-review-agent/src/cli/commands/` — start, dashboard command implementations
- `agents/ratan-code-review-agent/src/cli/config/loader.ts` — config file reader with `"env:VAR_NAME"` token resolution
- `agents/ratan-code-review-agent/src/cli/config/local-client.ts` — `LocalConfigClient` implementation
- `agents/ratan-code-review-agent/src/cli/dashboard/` — Express dashboard backend (health, findings, audit, stats APIs)
- `agents/ratan-code-review-agent/bin/ratan-code-review.cjs` — npm bin shim (CJS entry)
- `agents/ratan-code-review-agent/bin/ratan-code-review.js` — npm bin shim (ESM entry)
- `agents/ratan-code-review-agent/src/mastra/index.ts` — Mastra instance, agent/workflow registration
- `agents/ratan-code-review-agent/src/mastra/workflows/pr-review-workflow.ts` — top-level workflow definition (v2: scanner pipeline, merge gate, work items)
- `agents/ratan-code-review-agent/src/mastra/workflows/steps/` — individual workflow step implementations (fetch-pr, fetch-workitem-context, code-review, filter-issues, rescore, classify, code-summary, sonarqube-measures, merge-gate, create-workitems, comment)
- `agents/ratan-code-review-agent/src/mastra/workflows/scanners/` — scanner pipeline: types, scanner-pipeline, ai-review-scanner, cve-scanner, compliance-engine
- `agents/ratan-code-review-agent/src/mastra/workflows/services/` — audit-service, feedback-service, override-service
- `agents/ratan-code-review-agent/src/mastra/workflows/utils/` — finding-reconciler, review-tracker
- `agents/ratan-code-review-agent/src/mastra/agents/` — LLM agent definitions (openai-client, code-review-agent, code-review-rescore-agent, code-review-issue-classification-agent, code-change-summary-agent, code-review-evaluation-agent)
- `agents/ratan-code-review-agent/src/mastra/types/index.ts` — shared Zod schemas and TypeScript types
- `agents/ratan-code-review-agent/src/mastra/types/finding.ts` — NormalizedFinding schema, FindingCategory, FindingSeverity, EngineType, content hash computation
- `agents/ratan-code-review-agent/src/bootstrap/` — startup, PR scanning, session handling
- `agents/ratan-code-review-agent/src/webhooks/` — Express webhook receiver, HMAC validation, eligibility gate
- `agents/ratan-code-review-agent/src/evaluation/` — evaluation types, dataset fixtures, judge agent
- `agents/ratan-code-review-agent/templates/` — default config and prompt templates (published to npm)

### Dashboard (React SPA)
- `agents/ratan-code-review-agent/dashboard/` — Vite + React + Recharts SPA (DashboardOverview, FindingsPage, PRsPage, AdminPage)

### Packages
- `packages/finding-store/src/index.ts` — `FindingStore` class with SQLite persistence (findings, overrides, audit)
- `packages/finding-store/src/memory-store.ts` — `MemoryFindingStore` for tests
- `packages/agent-config-manager/src/config.ts` — `AgentConfigClient` class for ADO config fetching/caching
- `packages/agent-config-manager/src/types.ts` — `ConfigProvider` interface, config schema definitions
- `packages/agent-config-manager/src/session.ts` — `AgentConfigSession` with `registerProvider()`
- `packages/ratan-ado-api/src/client.ts` — `AzureDevOps` class, ~40 methods for ADO API
- `packages/ratan-code-review-agent-orm/src/db/schema.ts` — PostgreSQL schema (4 tables)
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

# CLI usage (after build)
node agents/ratan-code-review-agent/bin/ratan-code-review.cjs --help
node agents/ratan-code-review-agent/bin/ratan-code-review.cjs start
node agents/ratan-code-review-agent/bin/ratan-code-review.cjs start --watch
node agents/ratan-code-review-agent/bin/ratan-code-review.cjs start --pr-id 12345
node agents/ratan-code-review-agent/bin/ratan-code-review.cjs dashboard

# Run Mastra dev mode (starts PR scanning — has side effects)
pnpm agent:dev

# Run demo (live PR scanning — has side effects)
pnpm agent:demo

# Build Mastra artifacts
pnpm agent:mastra:build

# Regenerate evaluation JSON schema
pnpm --filter ratan-code-review codegen
```

## Environment

```bash
# Required
ADO_TOKEN=your_azure_devops_pat

# LLM endpoint (read from env by openai-client.ts)
OPENAI_BASE_URL=http://localhost:1218/v1
OPENAI_API_KEY=your_api_key

# Optional
SONARQUBE_TOKEN=your_sonarqube_token
DATABASE_URL=postgres_connection_string
```

## Important Notes

- `pnpm dev` / `pnpm demo` / `pnpm agent:dev` create real external side effects (ADO calls, PR comments). Do not run without user confirmation.
- `ADO_TOKEN` env var is required for Azure DevOps access.
- `OPENAI_BASE_URL` and `OPENAI_API_KEY` are read from environment by `openai-client.ts` (previously hardcoded).
- Workspace dependencies: `finding-store`, `agent-config-manager`, `ratan-ado-api`, `ratan-sonarqube-api` — defined in other packages in the monorepo.
- The `start` CLI command scaffolds `.ratan/` from `templates/` on first run, then reads config via `ConfigProvider` and runs the scan loop.
- The scanner pipeline uses `Promise.allSettled` for graceful degradation — individual scanner failures don't block the pipeline.
- Merge gate sets ADO PR Status (`succeeded`/`failed`) based on policy. Errors are non-fatal.
- Work item creation step handles errors gracefully (non-fatal).
- Comment step silently swallows per-line comment failures and still posts the main PR comment.
- Confidence score threshold for AI review findings is 0.8 (in `src/mastra/utils/const.ts`).
- `locate-pr-changes` builds a filtered/masked `codeChangesArray` but returns the original `codeDiffsArray` — verify before relying on incremental filtering.
- Test count: 10 test files (~134+ tests) covering CLI config, sensitive data mask, compliance engine, CVE scanner, scanner pipeline integration, finding types, commit parser, retry logic, eligibility gate, and local config client.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **code-review-agent** (2016 symbols, 3911 relationships, 141 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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
