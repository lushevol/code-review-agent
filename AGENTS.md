# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a pnpm workspace monorepo (pnpm 9) containing an AI-powered code review agent that automatically reviews Azure DevOps pull requests. It uses the **Mastra** framework for agent orchestration, connects to Azure DevOps (ADO) for PR data, calls OpenAI-compatible LLMs for review, and optionally integrates SonarQube for code quality metrics. Configuration and review prompts are resolved via the `ConfigProvider` interface — either from local filesystem (`.ratan/code-review-agent/`) or from ADO repos at runtime.

The package publishes as `ratan-code-review` on npm with a CLI binary for `scan`, `studio`, and `init` commands.

## Package Structure

| Workspace | Location | Purpose |
|---------|----------|---------|
| `ratan-code-review` | `agents/ratan-code-review-agent` | Main Mastra-based code review agent — agents, workflows, evaluation, CLI |
| `agent-config-manager` | `packages/agent-config-manager` | `ConfigProvider` interface, ADO config fetching/caching, LocalConfigClient |
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

### CLI Commands

The `ratan-code-review` CLI has three commands:

- **`scan`** — One-shot PR scan and review. Reads config from `.ratan/code-review-agent/config.json`, creates the appropriate `ConfigProvider` (local or ADO), and runs the scan loop. Supports `--watch` (30-min interval) and `--config <path>`.
- **`studio`** — Launches the pre-built Mastra Studio web UI (`prepublish` builds `.mastra/output/`).
- **`init`** — Scaffolds `.ratan/code-review-agent/config.json` with default template and prompt files.

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

### LLM Configuration

Model endpoint is hardcoded in `src/mastra/agents/openai-client.ts` (`http://localhost:1218/v1`, empty API key). Move to environment config before changing.

### Data Privacy
Diff text is masked via `maskSensitiveData()` using `redact-pii` (credentials only) and custom regex for Stripe keys, bearer tokens, and `password`/`token`/`secret` assignments.

### Config System
`agent-config-manager` provides the `ConfigProvider` interface. Two implementations:
- `AgentConfigClient` — fetches `config.json` and prompt markdown files from an ADO repo, caches with configurable TTL (default 5 min), resolves Handlebars templates.
- `LocalConfigClient` — reads from local filesystem via the config loader (`src/cli/config/loader.ts`), also supports Handlebars interpolation for path and content variables.

Prompt keys used: `review`, `review-rescore`, `issue-classification`, `summary`.

## Key Files

- `agents/ratan-code-review-agent/src/cli/index.ts` — CLI entry point with commander (scan/studio/init)
- `agents/ratan-code-review-agent/src/cli/commands/` — scan, studio, init command implementations
- `agents/ratan-code-review-agent/src/cli/config/loader.ts` — config file reader with `"env:VAR_NAME"` token resolution
- `agents/ratan-code-review-agent/src/cli/config/local-client.ts` — `LocalConfigClient` implementation
- `agents/ratan-code-review-agent/bin/ratan-code-review.js` — npm bin shebang shim
- `agents/ratan-code-review-agent/src/mastra/index.ts` — Mastra instance, agent/workflow registration
- `agents/ratan-code-review-agent/src/mastra/workflows/pr-review-workflow.ts` — top-level workflow definition
- `agents/ratan-code-review-agent/src/mastra/workflows/pr-review-issues-workflow.ts` — issue review sub-workflow
- `agents/ratan-code-review-agent/src/mastra/workflows/steps/` — individual workflow step implementations
- `agents/ratan-code-review-agent/src/mastra/agents/` — LLM agent definitions
- `agents/ratan-code-review-agent/src/mastra/types/index.ts` — shared Zod schemas and TypeScript types
- `agents/ratan-code-review-agent/src/bootstrap/` — startup, PR scanning, session handling
- `agents/ratan-code-review-agent/src/bootstrap/session.ts` — `extractAgentConfig` returns `ConfigProvider`
- `agents/ratan-code-review-agent/src/bootstrap/index.ts` — `startup()` (backwards compat) and `startScanWithProvider()`
- `agents/ratan-code-review-agent/src/bootstrap/pr-scan.ts` — PR scanner with 24h ADO repo cache
- `agents/ratan-code-review-agent/src/evaluation/` — evaluation types, dataset fixtures, judge agent
- `packages/agent-config-manager/src/config.ts` — `AgentConfigClient` class for ADO config fetching/caching
- `packages/agent-config-manager/src/types.ts` — `ConfigProvider` interface, config schema definitions
- `packages/agent-config-manager/src/session.ts` — `AgentConfigSession` with `registerProvider()`

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
node agents/ratan-code-review-agent/bin/ratan-code-review.js --help
node agents/ratan-code-review-agent/bin/ratan-code-review.js init
node agents/ratan-code-review-agent/bin/ratan-code-review.js scan
node agents/ratan-code-review-agent/bin/ratan-code-review.js scan --watch
node agents/ratan-code-review-agent/bin/ratan-code-review.js studio

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

# Optional
SONARQUBE_TOKEN=your_sonarqube_token
DATABASE_URL=postgres_connection_string
```

## Important Notes

- `pnpm dev` / `pnpm demo` create real external side effects (ADO calls, PR comments). Do not run without user confirmation.
- `ADO_TOKEN` env var is required for Azure DevOps access. `SONARQUBE_TOKEN` is optional.
- Workspace dependencies: `agent-config-manager`, `ratan-ado-api`, `ratan-sonarqube-api` — defined in other packages in the monorepo.
- The `scan` CLI command calls `startScanWithProvider()` which reads config via `ConfigProvider` and runs the scan loop.
- Comment step silently swallows per-line comment failures and still posts the main PR comment.
- Confidence score threshold for filtering is 0.8 (in `src/mastra/utils/const.ts`).
- `locate-pr-changes` builds a filtered/masked `codeChangesArray` but returns the original `codeDiffsArray` — verify before relying on incremental filtering.
- Pre-existing tests exist for sensitive-data-mask and LocalConfigClient.
