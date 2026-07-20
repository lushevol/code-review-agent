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
pnpm --filter ratan-code-review test:coverage
pnpm --filter ratan-code-review evaluate:golden --dry-run
```

The golden review corpus contains 25 synthetic PR changes across TypeScript,
JavaScript, Python, Java, Go, C#, Dockerfile, and Kubernetes YAML. The offline
test validates fixture structure and deterministic finding matching. A live
single-case evaluation, which calls the configured OCR endpoint but never ADO,
can be run explicitly with
`pnpm --filter ratan-code-review evaluate:golden --case ts-sql-injection`.

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

The root help output includes a compact cheatsheet for first-run scanning,
single-PR review, watch mode, and dashboard startup.

Commands:

| Command | Description |
|---------|-------------|
| `start` | Scaffold `.ratan/` config on first run, scan repos, process PR queue. `--watch` for 30-min polling with background feedback daemon. `--pr-id <id>` runs that review directly, waits for completion, and surfaces failures without requiring a detected build status; automatic scans still require a build pipeline. |
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

### Verify a published release

From a login shell containing the ADO and DeepSeek variables, run the reusable release verifier. It checks the expected npm versions, the installed CLI version, required variables without printing their values, ADO authentication, and access to the selected PR:

```bash
pnpm verify:release -- --pr-id 5
```

The defaults are ADO organization `lushe`, project `project1`, `ratan-code-review@0.1.10`, and `finding-store@0.1.1`. Override them with `ADO_ORGANIZATION`, `ADO_PROJECT`, `EXPECTED_AGENT_VERSION`, or `EXPECTED_STORE_VERSION`. A normal verification is read-only. To deliberately run a real review that can update PR comments and status, use:

```bash
pnpm verify:release -- --scan-pr 5 --expect-decision blocked
```

After pushing a fix, rerun with `--expect-decision allowed`. The assertion checks the latest merge-gate state, exactly one canonical summary, its decision heading, SonarQube result, reviewed commit, and current-format inline-thread state.
It also requires the conclusion to have the highest visible ADO thread ID. Add `--expect-fenced-suggestion` for a fixture expected to produce suggested code.

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
  → comment (prioritized inline comments + one newest conclusion)
```

### Scanner Pipeline

Three scanners run concurrently; individual failures are non-fatal:

| Scanner | Engine | What It Detects |
|---------|--------|----------------|
| OpenCodeReview | Native OCR rules + configured LLM | Code quality issues, bugs, and anti-patterns; one run receives deterministic focuses for tests, error handling, type design, and comments when relevant |
| CVE | SonarQube Issues API | Vulnerabilities, security hotspots |
| Compliance | Static analysis + YAML rules | TODO/FIXME, console.log, large files |

The main review comment contains only the merge decision, finding count, four
compact SonarQube signals, and reviewed commit. Re-review posts that canonical
conclusion last so it is the newest/top ADO thread, then removes prior
agent-generated conclusion threads. Inline notes use a compact
`priority · severity` heading, concise escaped title, explanation, and plain fenced code block. They
require a valid code location, are ordered by blocking status and severity,
deduplicated by content hash, and capped at 30. Previously linked inline threads
are refreshed in place instead of duplicated; threads for findings fixed by a
later commit are marked Fixed. Complete re-reviews persist disappeared findings
as resolved and matching findings as superseded. Incomplete reviews preserve
prior finding state. A newer review for the same PR cancels stale workflow
output before it can publish governance results. These rules do not
alter persisted severity or merge policy.

Pilot metrics are written to each audit record's `rawScannerOutputs`: selected
focuses and reasons, OCR status/warnings/duration/reviewed-file count, postable
finding count, and duplicate/inline suppression counts. The payload is an
explicit allowlist and excludes arbitrary model configuration. It is available
through `/api/audit`; no focus/status dashboard controls are enabled yet.
Unknown string categories returned by OpenCodeReview are normalized to `other`
so one upstream vocabulary change cannot discard an otherwise valid review.
Failure audit records retain any focuses selected before the failure.

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

- The complete suite passes — 36 files and 249 tests, including the loopback dashboard integration and installed-package CLI coverage.
- Package coverage is 62.35% statements, 51.1% branches, 67.55% functions,
  and 63.37% lines.
- The offline suite includes golden finding-quality controls plus mocked merge
  gate, work-item, and SonarQube failure-path coverage.
- `pnpm build` passes.
- The OpenCodeReview runner passes the native rule file through unchanged and isolates its generated runtime configuration.
- Review-focus routing and finding-to-ADO-thread feedback linkage are covered by automated tests.
- Audit pilot metrics and their API export are covered without exposing secret configuration.
- The synthetic `ts-sql-injection` live golden case passes with recall `1.0`
  and precision `1.0` against the configured OCR endpoint.

The published `ratan-code-review@0.1.8` package completed a two-iteration pilot
on `example-repo` PR `#5`. The vulnerable commit produced one critical SQL
injection, a failed merge status, one concise inline comment, and one canonical
`Changes requested` summary. After a real parameterization fix commit, the
same package marked the linked finding thread Fixed, changed the merge status
to succeeded, and updated that canonical summary in place to `No blocking
issues`. Both summaries included the SonarQube result (`Not available` for this
configuration) and the reviewed commit. The older duplicate conclusion was
deleted. A pre-`0.1.8` inline thread had no persisted association and required
one-time manual cleanup; new linked threads reconcile automatically.
Published `ratan-code-review@0.1.9` verified newest-conclusion replacement on
fresh synthetic ADO PR `#6`, but rendered inspection exposed literal bold
markers in the long model title and ADO's apply-suggestion widget. Published
`0.1.10` replaced that format with a bounded escaped heading and plain code
fence. A real continuation commit parameterized the query; its review marked
the linked thread Resolved, posted a succeeded status, and created the sole
allowed conclusion as the highest/newest visible thread.
The earlier PR `#4` attempt remains incomplete historical evidence.

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
