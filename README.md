# PR Guardian Copilot — Code Review Agent

AI-powered Azure DevOps pull request governance platform built as a pnpm workspace. Scans PRs through a multi-scanner pipeline (AI code review, CVE scanning, compliance checking), enforces merge policies via ADO PR status, and provides a dashboard for findings management.

Originally a basic Mastra-based code review agent, evolved into a full governance platform (v2: PR Guardian Copilot).

## Packages

| Workspace | Location | Purpose |
| --- | --- | --- |
| `ratan-code-review` | `agents/ratan-code-review-agent` | Mastra workflows, scanner pipeline, CLI, webhooks, dashboard backend |
| `finding-store` | `packages/finding-store` | SQLite-based persistence for findings, overrides, and audit records |
| `agent-config-manager` | `packages/agent-config-manager` | Runtime config and prompt loading from Azure DevOps or local filesystem |
| `ratan-ado-api` | `packages/ratan-ado-api` | Azure DevOps API client |
| `ratan-code-review-agent-orm` | `packages/ratan-code-review-agent-orm` | Drizzle ORM tables and repository helpers (PostgreSQL) |
| `ratan-markdown-tool` | `packages/ratan-markdown-tool` | Markdown/HTML/JSON conversion helpers |
| `ratan-sonarqube-api` | `packages/ratan-sonarqube-api` | SonarQube API client |

## Setup

```bash
pnpm install
```

The workspace is currently compatible with pnpm 11. The Mastra artifact build needs generated dependency build scripts to run, so `ratan-code-review-agent` sets `PNPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS=true` only for `mastra:build`.

## Safe Verification

These commands do not scan live pull requests or post comments:

```bash
pnpm build
pnpm test
pnpm agent:mastra:build
```

The installable CLI can be checked without contacting Azure DevOps:

```bash
pnpm --filter ratan-code-review build
node agents/ratan-code-review-agent/dist/cli.js --help
node agents/ratan-code-review-agent/dist/cli.js init
pnpm --filter ratan-code-review pack --pack-destination /tmp
```

After `mastra:build`, start the generated Mastra API server with:

```bash
pnpm agent:start
```

The API listens at `http://localhost:4111/api`.

## Runtime Commands

These commands connect to Azure DevOps and can create external side effects:

```bash
pnpm agent:dev
pnpm agent:demo
ratan-code-review scan
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
| `scan` | One-shot PR scan/review. `--watch` for 30-min polling, `--mode=service` for persistent webhook-driven operation |
| `studio` | Launch pre-built Mastra Studio web UI |
| `init` | Scaffold `.ratan/code-review-agent/config.json` with default template and prompt files |
| `dashboard` | Start PR Guardian dashboard (Express REST API + React SPA) |
| `override` | Manage finding resolution overrides (waive, false-positive, risk-accept) |
| `feedback` | Feedback operations; `feedback-daemon` for ADO comment reaction collection |
| `webhook` | Start webhook service + auto-register ADO event subscriptions |

To scaffold a local config first:

```bash
ratan-code-review init
```

Then edit `.ratan/code-review-agent/config.json` with your ADO organization and project.

The CLI accepts `ADO_TOKEN`, `ADO_ORGANIZATION`, `ADO_PROJECT` from the
environment. Additional settings use `ADO_CONFIG_REPO`, `ADO_CONFIG_BRANCH`,
`ADO_CONFIG_BASE_PATH`, and `ADO_PROXY_URL`; optional integrations use
`SONARQUBE_TOKEN`, `DATABASE_URL`, `OPENAI_BASE_URL`, and `OPENAI_API_KEY`.
Set `ADO_PROXY_URL=none` or pass `--ado-proxy-url none` when the machine should
connect to Azure DevOps directly instead of using the packaged default proxy.

To run a one-shot scan with a custom config path:

```bash
ratan-code-review scan --config /path/to/config
```

For a specific PR:

```bash
ratan-code-review scan --pr-id 12345
```

For continuous scanning (every 30 minutes):

```bash
ratan-code-review scan --watch
```

For webhook-driven service mode:

```bash
ratan-code-review scan --mode=service
```

To start the dashboard:

```bash
ratan-code-review dashboard
```

## Architecture

### Workflow

```
PR Event (webhook/poll) → Eligibility Gate → fetchPR → fetchWorkItemContext
  → scannerPipeline (AI Review + CVE + Compliance, parallel)
  → correlation/dedup → persist to FindingStore
  → codeSummary (parallel) + sonarqubeMeasures (parallel)
  → mergeGate (set ADO PR status)
  → createWorkItems (Bug/Task for critical/high)
  → comment (PR summary + inline comments + re-review reconciliation)
```

### Scanner Pipeline

Three scanners run concurrently; individual failures are non-fatal:

| Scanner | Engine | What It Detects |
|---------|--------|----------------|
| AI Review | LLM (GPT-5-mini) | Code quality issues, bugs, anti-patterns |
| CVE | SonarQube Issues API | Vulnerabilities, security hotspots |
| Compliance | Static analysis + YAML rules | TODO/FIXME, console.log, large files |

### Webhooks

- Express receiver with HMAC-SHA256 validation
- Auto-registers ADO `git.pullrequest.created`/`.updated` subscriptions
- Dedup window (5 min)
- Polling fallback (30 min)

### Dashboard

- React SPA (Vite + Recharts + React Router)
- 4 pages: Overview (charts), Findings Explorer, PR Listing, Admin
- Express backend: `/api/health`, `/api/findings`, `/api/audit`, `/api/stats`

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

The ADO config repository currently contains starter files under
`/code-review-agent`:

- `config.json`
- `prompts/review.md`
- `prompts/review-rescore.md`
- `prompts/issue-classification.md`
- `prompts/summary.md`

## Current Verification Status

As of the latest local verification (v2):

- `pnpm test` passes — 10 test files, ~134+ tests.
- `pnpm build` passes.
- `pnpm -r pack --pack-destination /tmp/code-review-agent-packs` creates tarballs for all publishable workspaces.
- `npm publish --dry-run /tmp/code-review-agent-packs/ratan-code-review-0.1.0.tgz` succeeds for the CLI package.
- Installing the packed CLI into a clean local consumer project works on macOS, and `ratan-code-review --help` runs from `node_modules/.bin`.
- ADO authentication/connectivity works, and the configured remote prompt files load through `agent-config-manager`.

The end-to-end goal is therefore not complete yet: the starter config still needs a real `scanRepoNames` target, and a controlled live test PR review must be run before claiming full ADO review operation.

## Environment

Required for live operation:

```bash
ADO_TOKEN=your_azure_devops_pat

OPENAI_BASE_URL=http://localhost:1218/v1
OPENAI_API_KEY=your_api_key
```

Optional:

```bash
SONARQUBE_TOKEN=your_sonarqube_token
DATABASE_URL=postgres_connection_string
```

## Runtime Compatibility

`pnpm start` uses `scripts/protobufjs-esm-loader.mjs` because the Mastra artifact externalizes `protobufjs`, and Node 24 requires explicit file and JSON import handling for some `protobufjs` subpaths emitted into the generated ESM bundle.

## Architecture Notes

Runtime architecture and current design risks are documented in:

- `agents/ratan-code-review-agent/docs/RUNTIME_ARCHITECTURE.md`
- `agents/ratan-code-review-agent/docs/PROJECT_ANALYSIS.md`
- `CLAUDE.md` (points to `AGENTS.md`)
- `docs/adr/0001-config-provider-interface.md`
- `docs/PRD-260703-1.md` — PR Guardian Copilot Product Requirements Document
- `openspec/changes/pr-guardian-copilot/` — Design specs for v2 features
