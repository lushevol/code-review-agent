# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a pnpm workspace monorepo (pnpm 9) containing an AI-powered code review agent that automatically reviews Azure DevOps pull requests. It uses the **Mastra** framework for agent orchestration, connects to Azure DevOps (ADO) for PR data, calls OpenAI-compatible LLMs for review, and optionally integrates SonarQube for code quality metrics. All configuration and review prompts live in external ADO repositories, fetched at runtime by `agent-config-manager`.

## Package Structure

| Workspace | Location | Purpose |
|---------|----------|---------|
| `ratan-code-review-agent` | `agents/ratan-code-review-agent` | Main Mastra-based code review agent — agents, workflows, evaluation |
| `agent-config-manager` | `packages/agent-config-manager` | Fetches and caches agent config + prompt files from ADO repos |
| `ratan-ado-api` | `packages/ratan-ado-api` | Azure DevOps API client |
| `ratan-code-review-agent-orm` | `packages/ratan-code-review-agent-orm` | Drizzle ORM helpers and schema |
| `ratan-markdown-tool` | `packages/ratan-markdown-tool` | Markdown conversion utilities (html2md, json2md, markdown2html) |
| `ratan-sonarqube-api` | `packages/ratan-sonarqube-api` | SonarQube web API client for PR measures |

## Architecture

### Workflow (Mastra)

```
startup → scanPRs(ADO) → prReviewWorkflow:
  fetch-pr-details
    ├── pr-review-issues-workflow:
    │     locate-pr-changes → code-review → filter-issues → code-review-rescore → filter-issues → issue-classification
    ├── code-summary
    └── sonarqube-measures
  comment-review-results (posts to ADO)
```

### Agents (registered in `src/mastra/index.ts`)
- **codeReviewAgent** — GPT-5-mini, reviews code diffs, returns issues with Zod schema
- **codeReviewRescoreAgent** — re-evaluates confidence scores
- **codeReviewIssueClassificationAgent** — categorizes issues
- **codeChangeSummaryAgent** — summarizes PR changes
- **codeReviewEvaluationJudgeAgent** — evaluation judge

### LLM Configuration

Model endpoint is hardcoded in `src/mastra/agents/openai-client.ts` (`http://localhost:1218/v1`, empty API key). Move to environment config before changing.

### Data Privacy
Diff text is masked via `maskSensitiveData()` using `redact-pii` (credentials only) and custom regex for Stripe keys, bearer tokens, and `password`/`token`/`secret` assignments.

### Config System
`agent-config-manager` fetches `config.json` and prompt markdown files from an ADO repo, caches them with a configurable TTL (default 5 min), and resolves Handlebars templates. Prompt keys used: `review`, `review-rescore`, `issue-classification`, `summary`.

## Key Files

- `agents/ratan-code-review-agent/src/mastra/index.ts` — Mastra instance, agent/workflow registration
- `agents/ratan-code-review-agent/src/mastra/workflows/pr-review-workflow.ts` — top-level workflow definition
- `agents/ratan-code-review-agent/src/mastra/workflows/pr-review-issues-workflow.ts` — issue review sub-workflow
- `agents/ratan-code-review-agent/src/mastra/workflows/steps/` — individual workflow step implementations
- `agents/ratan-code-review-agent/src/mastra/agents/` — LLM agent definitions
- `agents/ratan-code-review-agent/src/mastra/types/index.ts` — shared Zod schemas and TypeScript types
- `agents/ratan-code-review-agent/src/bootstrap/` — startup, PR scanning, session handling
- `agents/ratan-code-review-agent/src/evaluation/` — evaluation types, dataset fixtures, judge agent
- `packages/agent-config-manager/src/config.ts` — `AgentConfigClient` class for ADO config fetching/caching
- `packages/agent-config-manager/src/types.ts` — config schema definitions

## Commands

```bash
# Install dependencies (pnpm 9+)
pnpm install

# Build all packages
pnpm build

# Build a specific package
pnpm agent:build
pnpm --filter agent-config-manager build

# Run Mastra dev mode (starts PR scanning — has side effects)
pnpm agent:dev

# Run demo (live PR scanning — has side effects)
pnpm agent:demo

# Run all tests
pnpm test

# Run a single test file
pnpm --filter ratan-code-review-agent exec vitest run src/mastra/utils/sensitive-data-mask.spec.ts

# Build Mastra artifacts
pnpm agent:mastra:build

# Regenerate evaluation JSON schema
pnpm --filter ratan-code-review-agent codegen
```

## Environment

```bash
# Required
ADO_TOKEN=your_azure_devops_pat

# Optional
SONARQUBE_TOKEN=your_sonarqube_token
DATABASE_URL=postgres_connection_string
```

## Important Notes

- `pnpm dev` / `pnpm demo` create real external side effects (ADO calls, PR comments). Do not run without user confirmation.
- `ADO_TOKEN` env var is required for Azure DevOps access. `SONARQUBE_TOKEN` is optional.
- Workspace dependencies: `agent-config-manager`, `ratan-ado-api`, `ratan-sonarqube-api` — defined in other packages in the monorepo.
- Comment step silently swallows per-line comment failures and still posts the main PR comment.
- Confidence score threshold for filtering is 0.8 (in `src/mastra/utils/const.ts`).
- `locate-pr-changes` builds a filtered/masked `codeChangesArray` but returns the original `codeDiffsArray` — verify before relying on incremental filtering.
- Test infrastructure exists (vitest) but only one spec file exists. Add tests for utility functions and workflow steps.
