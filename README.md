# PR Guardian Copilot — Code Review Agent

AI-powered Azure DevOps pull request governance platform built as a pnpm workspace. Scans PRs through a multi-scanner pipeline (AI code review, CVE scanning, compliance checking), enforces merge policies via ADO PR status, and provides a dashboard for findings management.

Originally a basic framework-based code review agent, it evolved into a full governance platform (v2: PR Guardian Copilot). The current production runtime uses plain TypeScript orchestration and OpenCodeReview as its sole LLM review engine.

## Packages

| Workspace | Location | Purpose |
| --- | --- | --- |
| `ratan-code-review` | `agents/ratan-code-review-agent` | TypeScript review runtime, scanner pipeline, CLI, webhooks, dashboard backend |
| `finding-store` | `packages/finding-store` | SQLite-based persistence for findings, overrides, and audit records |
| `agent-config-manager` | `packages/agent-config-manager` | Runtime configuration loading from Azure DevOps or local filesystem |
| `ratan-ado-api` | `packages/ratan-ado-api` | Azure DevOps API client |
| `ratan-code-review-agent-orm` | `packages/ratan-code-review-agent-orm` | Drizzle ORM tables and repository helpers (PostgreSQL) |
| `ratan-markdown-tool` | `packages/ratan-markdown-tool` | Markdown/HTML/JSON conversion helpers |
| `ratan-sonarqube-api` | `packages/ratan-sonarqube-api` | SonarQube API client |

## Setup

```bash
pnpm install
```

The workspace is currently compatible with pnpm 11.

## Safe Verification

These commands do not scan live pull requests or post comments:

```bash
pnpm build
pnpm test
```

The installable CLI can be checked without contacting Azure DevOps:

```bash
pnpm --filter ratan-code-review build
node agents/ratan-code-review-agent/dist/cli.js --help
node agents/ratan-code-review-agent/dist/cli.js start --help
pnpm --filter ratan-code-review pack --pack-destination /tmp
```

## Runtime Commands

These commands connect to Azure DevOps and can create external side effects:

```bash
pnpm agent:dev
pnpm agent:demo
ratan-code-review start
```

Do not run them without a valid `ADO_TOKEN` and explicit intent to scan PRs and post review comments.

## CLI Usage

After publishing or installing the `ratan-code-review` package:

```bash
ratan-code-review --help
```

Commands:

| Command | Description |
|---------|-------------|
| `start` | Scaffold `.ratan/` config on first run, scan repos, process PR queue. `--watch` for 30-min polling with background feedback daemon. `--pr-id <id>` for single PR. |
| `dashboard` | Start PR Guardian dashboard (Express REST API + React SPA) |

On first run, `start` creates `.ratan/config.json`, `.ratan/opencodereview/rule.json`,
`data/`, and `logs/`. Edit `config.json` with your ADO organization and project
before scanning.

Default config and OpenCodeReview rule templates are at `templates/` in the package — they're
copied to `.ratan/` on first `start` run. You can edit the generated files or
customize the templates before re-running.

All operational settings live under the root `config` object. Secrets use
`env:NAME` references and are resolved only at runtime. `sonarQube.url` and
`sonarQube.token`, retry backoff, polling/feedback intervals, ports, merge policy,
and structured logging are root settings; no Sonar or retry setting is hard-coded.
Logs are JSONL files in `.ratan/logs` by default, redact secret-like fields, and
can be configured through `config.logging` (`level`, `format`, `console`, `file`,
`directory`, and `retentionDays`).

To run a one-shot scan:

```bash
ratan-code-review start
```

For a specific PR:

```bash
ratan-code-review start --pr-id 12345
```

For continuous scanning with background feedback daemon (every 30 minutes):

```bash
ratan-code-review start --watch
```

With a custom config path:

```bash
ratan-code-review start --config /path/to/config
```

To start the dashboard:

```bash
ratan-code-review dashboard
```

## Architecture

### Workflow

```
PR Event (webhook/poll) → Eligibility Gate → fetchPR → fetchWorkItemContext
  → scannerPipeline (OpenCodeReview + optional CVE/Compliance, parallel)
  → correlation/dedup → persist to FindingStore
  → sonarqubeMeasures
  → mergeGate (set ADO PR status)
  → createWorkItems (Bug/Task for critical/high)
  → comment (consolidated summary + prioritized postable inline comments)
```

### Scanner Pipeline

Three scanners run concurrently; individual failures are non-fatal:

| Scanner | Engine | What It Detects |
|---------|--------|----------------|
| OpenCodeReview | Native OCR rules + configured LLM | Code quality issues, bugs, and anti-patterns; one run receives deterministic focuses for tests, error handling, type design, and comments when relevant |
| CVE | SonarQube Issues API | Vulnerabilities, security hotspots |
| Compliance | Static analysis + YAML rules | TODO/FIXME, console.log, large files |

The main review groups correlated findings into blocking, important, and
advisory categories, lists concise finding details, and includes the selected
OCR focuses. Inline comments require a valid code location, are ordered by
blocking status and severity, deduplicated by content hash, suppressed when the
finding was already linked to an ADO thread, and capped at 30. These presentation
rules do not alter persisted severity or merge policy.

### Webhooks

- Express receiver with HMAC-SHA256 validation
- Auto-registers ADO `git.pullrequest.created`/`.updated` subscriptions
- Dedup window (5 min)
- Polling fallback (30 min)

### Dashboard

- React SPA (Vite + Recharts + React Router)
- 4 pages: Overview (charts), Findings Explorer, PR Listing, Admin
- Express backend: `/api/health`, `/api/queue`, `/api/findings`, `/api/audit`, `/api/stats`, `/api/prs`

## Azure DevOps MCP

Codex is configured with a global Azure DevOps MCP server named
`azure-devops`. The launcher lives at:

```bash
scripts/ado-mcp.sh
```

The launcher reads `.env`, builds the Azure DevOps MCP `PERSONAL_ACCESS_TOKEN`
from `ADO_TOKEN` at runtime, and starts:

```bash
npx -y @azure-devops/mcp "$ADO_ORGANIZATION" --authentication pat
```

Local MCP smoke testing confirms the server starts for organization `lushe`
and exposes Azure DevOps tools. A new Codex session may be required before the
newly registered MCP tools are visible to the agent runtime.

OpenCodeReview configuration is scaffolded locally under `.ratan/`:

- `config.json` — includes `config.openCodeReview.llm` and the native rule path
- `opencodereview/rule.json` — native OpenCodeReview review rules

## Current Verification Status

As of the latest local verification:

- `pnpm test` passes — 171 tests.
- `pnpm build` passes.
- The OpenCodeReview runner passes the native rule file through unchanged and isolates its generated runtime configuration.
- Review-focus routing and finding-to-ADO-thread feedback linkage are covered by automated tests.

The end-to-end goal is therefore not complete yet: the starter config still needs a real `scanRepoNames` target, and a controlled live test PR review must be run before claiming full ADO review operation.

## Environment

Required for live operation:

```bash
ADO_TOKEN=your_azure_devops_pat

OCR_LLM_TOKEN=your_api_key
```

The endpoint, model, provider mode, and `env:OCR_LLM_TOKEN` reference belong in
`config.openCodeReview.llm`. Optional integrations use:

```bash
SONARQUBE_TOKEN=your_sonarqube_token
DATABASE_URL=postgres_connection_string
```

## Architecture Notes

Runtime architecture and current design risks are documented in:

- `agents/ratan-code-review-agent/docs/RUNTIME_ARCHITECTURE.md`
- `agents/ratan-code-review-agent/docs/PROJECT_ANALYSIS.md`
- `CLAUDE.md` (points to `AGENTS.md`)
- `docs/adr/0001-config-provider-interface.md`
- `docs/PRD-260703-1.md` — PR Guardian Copilot Product Requirements Document
- `openspec/changes/pr-guardian-copilot/` — Design specs for v2 features
