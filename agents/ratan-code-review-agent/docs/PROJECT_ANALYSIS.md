# Project Analysis

## Summary

`ratan-code-review` (PR Guardian Copilot) is a TypeScript package that automates company pull request governance. It scans Azure DevOps repositories for active pull requests, runs a multi-scanner pipeline (AI code review, CVE scanning, compliance checking), persists findings to a SQLite store, enforces merge policy via ADO PR status, auto-creates work items for critical issues, and posts review comments back to Azure DevOps. A React dashboard provides visibility into findings and history.

The project evolved from a basic Mastra-based code review agent (v1) into a full governance platform (v2: PR Guardian Copilot) with scanner pipeline, webhooks, merge gate, audit trail, override management, and dashboard.

The project is structured as a pnpm workspace monorepo with the main package (`ratan-code-review`) and six supporting packages (`finding-store`, `agent-config-manager`, `ratan-ado-api`, `ratan-code-review-agent-orm`, `ratan-markdown-tool`, `ratan-sonarqube-api`).

## Primary Capabilities

- Scans Azure DevOps repositories using include patterns from root config.
- Filters PRs by creation window, validity, and whether the agent has already commented.
- Fetches full PR details, code diffs, comments, properties, and latest iteration metadata.
- Extracts ADO work item IDs from commit messages, fetches descriptions and acceptance criteria for richer AI review context.
- Masks sensitive credentials in diffs before prompting review agents.
- Filters deleted files and allowlist/blocklist paths before review.
- **Runs a multi-scanner pipeline (v2):**
  - AI Review Scanner — LLM-based code quality review, confidence rescoring, issue classification
  - CVE Scanner — SonarQube vulnerability and security hotspot detection
  - Compliance Engine — Static analysis (TODO/FIXME, console.log, large files, YAML rules)
- Correlates and deduplicates findings across scanners using SHA-256 content hashing.
- Persists findings to SQLite FindingStore with override, audit, and re-review support.
- **Merge governance (v2):** Evaluates blocking findings against policy, sets ADO PR status.
- **Work item creation (v2):** Auto-creates ADO Bug (critical) and Task (high) with PR artifact links.
- Posts inline code comments and a main PR summary comment with re-review reconciliation.
- **Webhook-driven (v2):** Express webhook receiver with HMAC validation, dedup, auto-subscription.
- **Dashboard (v2):** React SPA with overview charts, findings explorer, PR listing, admin controls.
- **Override management (v2):** Waive, false-positive, and risk-accept workflows with two-person approval and expiry.
- **Audit trail (v2):** Append-only records of every review with commit hash, engine versions, model version.
- **Feedback daemon (v2):** Semi-automated false-positive pattern collection from ADO comment reactions.
- Stores the reviewed PR iteration id to support incremental future reviews.
- Provides early evaluation schemas and fixtures for regression testing review quality.

## Architecture

The public entry point in `src/index.ts` exports:

- `startup` from `src/bootstrap/index.ts`
- `mastra` from `src/mastra/index.ts`
- shared types from `src/mastra/types`

The package also builds an npm CLI entry point `ratan-code-review` with commands:

- `scan` — one-shot PR review scan (`--watch` for 30-min interval, `--mode=service` for webhook-driven).
- `studio` — launches the pre-built Mastra Studio web UI.
- `init` — scaffolds `.ratan/code-review-agent/config.json` with defaults.
- `dashboard` — starts the PR Guardian dashboard (Express backend + React SPA).
- `override` — manage finding resolution overrides.
- `feedback` — feedback operations; `feedback-daemon` for reaction collection.
- `webhook` — start webhook service + auto-register ADO subscriptions.

Runtime work starts in `startup`. It creates an `agent-config-manager` session, scans for pending PRs, and starts a Mastra `prReviewWorkflow` run for each pending PR. Each run receives only a `configSessionId` in runtime context; steps use that id to recover the configured ADO and SonarQube clients.

The Mastra instance registers one workflow and five agents:

- `codeReviewAgent`
- `codeReviewRescoreAgent`
- `codeReviewIssueClassificationAgent`
- `codeChangeSummaryAgent`
- `codeReviewEvaluationJudgeAgent`

Storage is configured as in-memory LibSQL, logging uses `PinoLogger`, and Mastra telemetry/observability are disabled by default.

## Workflow (v2)

`pr-review-workflow` accepts:

```json
{
  "prId": 12345
}
```

It executes:

1. `fetch-pr-details`: fetches PR details through the ADO client.
2. `fetch-workitem-context`: extracts ADO work item IDs from commit messages, fetches their descriptions.
3. **`scanner-pipeline`**: runs all scanners concurrently via `Promise.allSettled`:
   - AI Review Scanner (LLM → rescore → classify → map to NormalizedFinding)
   - CVE Scanner (SonarQube Issues API → NormalizedFinding)
   - Compliance Engine (static analysis + YAML rules → NormalizedFinding)
   - Correlation / dedup / persist to FindingStore
4. Parallel branch:
   - `code-summary`
   - `sonarqube-measures`
5. `merge-gate`: evaluates blocking findings, sets ADO PR status.
6. `create-workitems`: creates Bug/Task for critical/high findings.
7. `comment-review-results`: posts inline comments + main PR comment with re-review reconciliation.

## Data Contracts

### AI Review Issue (legacy, from code-review agent)

```ts
{
  file: string;
  line: number;
  severity: "Critical" | "High" | "Medium" | "Low";
  priority: "P1" | "P2" | "P3" | "P4" | "P5";
  message: string;
  suggestion: string;
  suggestion_code: string;
  confidence_score: number;
}
```

### NormalizedFinding (v2 — unified across scanners)

```ts
{
  id: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  message: string;
  suggestion: string;
  severity: "Critical" | "High" | "Medium" | "Low";
  category: string;
  subCategory: string;
  engine: "ai-review" | "cve" | "compliance";
  contentHash: string;            // SHA-256 of filePath + surrounding code
  resolution: "open" | "waived" | "fp" | "risk-accepted" | "auto-resolved";
  createdAt: string;
  metadata?: Record<string, unknown>;
}
```

The confidence filter keeps only AI review issues with `confidence_score >= 0.8`.

## Runtime Dependencies

External package dependencies include:

- `@mastra/core`, `mastra`, `@mastra/libsql`, `@mastra/loggers`, `@mastra/memory`
- `@ai-sdk/openai`, `openai`, `ai`
- `zod`
- `rxjs`
- `minimatch`
- `yaml`
- `redact-pii`
- `commander`
- `express`, `cors`
- `better-sqlite3`
- `finding-store`, `agent-config-manager`, `ratan-ado-api`, `ratan-sonarqube-api`

The last four are workspace/internal dependencies and must be available to install, build, and run the package.

## Configuration

The README expects environment values:

```env
ADO_TOKEN=your_ado_token_here
OPENAI_BASE_URL=http://localhost:1218/v1
OPENAI_API_KEY=your_api_key_here
ADO_CONFIG_REPO=your_config_repo
ADO_CONFIG_BRANCH=main
SONARQUBE_TOKEN=your_sonarqube_token_here
DATABASE_URL=postgres_connection_string
```

`src/demo.ts` also reads `DATABASE_URL`.

CLI users can also provide `ADO_ORGANIZATION`, `ADO_PROJECT`, `ADO_CONFIG_BASE_PATH`, and `ADO_PROXY_URL`. Set `ADO_PROXY_URL=none` to bypass the packaged default proxy in `ratan-ado-api` and connect to Azure DevOps directly.

Agent behavior is mostly driven through `agent-config-manager`, especially prompt names:

- `review`
- `review-rescore`
- `issue-classification`
- `summary`

Root config also controls:

- `scanRepoNames`
- `scanPRCreatedDaysAgo`
- `filePathsAllowlist`
- `filePathsBlocklist`
- `mergePolicy` — severity/category thresholds for merge blocking
- `webhook` — HMAC secret, dedup window
- `remediationTasks` — work item creation settings
- `dashboard` — dashboard config
- `audit` — retention policy
- `feedbackDaemon` — feedback collection settings

## Source Structure (v2)

```
src/
  index.ts                          -- Package entry point (re-exports)
  bootstrap/  cli/  evaluation/  webhooks/
    bootstrap/
      index.ts                      -- startup(), startScanWithProvider(), startReviewPrWithProvider()
      session.ts                    -- AgentConfigSession singleton
      pr-scan.ts                    -- PR scanner (RxJS Observable, 24h repo cache)
    cli/
      index.ts                      -- CLI entry point (commander, 7 commands)
      commands/
        scan.ts, studio.ts, init.ts, dashboard.ts, webhook.ts
        override.ts, feedback.ts, feedback-daemon.ts
      config/
        loader.ts                   -- Config file reader + "env:VAR_NAME" resolution
        local-client.ts             -- LocalConfigClient
      dashboard/
        index.ts                    -- Express dashboard app
    webhooks/
      index.ts                      -- Express webhook receiver (HMAC validation)
      eligibility.ts                -- PR eligibility gate
  mastra/
    index.ts                        -- Mastra instance
    agents/                         -- 5 LLM agent definitions
    workflows/
      pr-review-workflow.ts         -- Top-level workflow (v2)
      steps/                        -- Individual workflow steps
      scanners/
        types.ts                    -- Scanner interface
        scanner-pipeline.ts         -- Promise.allSettled scanner runner
        ai-review-scanner.ts        -- LLM review scanner
        cve-scanner.ts              -- SonarQube CVE scanner
        compliance-engine.ts        -- Static analysis + YAML rules
      services/
        audit-service.ts            -- Audit record service
        feedback-service.ts         -- ADO comment reaction collector
        override-service.ts         -- Finding override management
      utils/
        finding-reconciler.ts       -- Re-review: create/supersede/resolve/keep
        review-tracker.ts           -- Reviewed iteration tracking
    types/
      index.ts                      -- Shared Zod schemas
      finding.ts                    -- NormalizedFinding schema, content hash
    utils/
      sensitive-data-mask.ts        -- PII/secret masking
      chunk-content.ts              -- Diff chunking
      confidence-score-filter.ts    -- 0.8 threshold filter
      ...                           -- Retry, sort, duplicate check, etc.
  evaluation/
    type.ts, judge.ts, scorer.ts, dataset/

dashboard/                          -- React SPA (Vite + Recharts)
  src/
    App.tsx                         -- Router
    pages/
      DashboardOverview.tsx         -- Charts
      FindingsPage.tsx              -- Findings explorer
      PRsPage.tsx                   -- PR listing
      AdminPage.tsx                 -- Admin controls
```

## Test Suite (10 files, ~134+ tests)

- `src/cli/bin.spec.ts` — CLI binary tests
- `src/cli/config/local-client.spec.ts` — LocalConfigClient tests
- `src/mastra/types/finding.spec.ts` — Finding type tests
- `src/mastra/utils/commit-parser.spec.ts` — Commit parser tests
- `src/mastra/utils/retry.spec.ts` — Retry tests
- `src/mastra/utils/sensitive-data-mask.spec.ts` — Sensitive data masking tests
- `src/mastra/workflows/scanners/compliance-engine.spec.ts` — Compliance engine tests
- `src/mastra/workflows/scanners/cve-scanner.spec.ts` — CVE scanner tests
- `src/mastra/workflows/scanners/scanner-pipeline.integration.spec.ts` — Pipeline integration tests
- `src/webhooks/eligibility.spec.ts` — Eligibility gate tests

## Evaluation State

The evaluation area has:

- Zod schemas for test cases, results, AI judge input, and aggregate metrics.
- A generated JSON schema for code-change review test cases.
- One Java fixture that expects detection of a null pointer risk.
- An LLM judge agent registered in Mastra.
- A standalone evaluator class in `src/evaluation/judge.ts`.

Gaps:

- `src/evaluation/scorer.ts` is empty.
- `startupEvaluation` logs that evaluation mode is not implemented.
- There is no command that runs the full evaluation loop against the current review agent output.

## Risks And Gaps

- Current local verification proves build, tests, pack, publish dry-run, installed CLI `--help`, ADO authentication/connectivity, remote config loading, and remote prompt loading. It does not yet prove a live review run.
- The ADO config repo currently contains starter files under `/code-review-agent`. `scanRepoNames` is intentionally set to `__replace_with_target_repo_name__`, so a real target repo pattern must be configured before live scanning.
- The model endpoint reads from env (`OPENAI_BASE_URL + OPENAI_API_KEY`) but may need endpoint-specific authentication.
- `locate-pr-changes` appears to calculate filtered/masked `codeChangesArray` but returns the original `codeDiffsArray`; this may bypass allowlist/blocklist or incremental filtering.
- Scanner pipeline uses `Promise.allSettled` — individual failures are logged but the pipeline continues. Some failures may mask important errors.
- Inline comment failures are swallowed silently in `comment.ts`.
- The workflow output schema does not match the shape returned by the final `comment` step.
- FindingStore uses SQLite (better-sqlite3). If horizontal scale is needed, migration to PostgreSQL Drizzle ORM may be required.
- Webhook receiver lacks authentication/authorization beyond HMAC validation.
- Dashboard has no built-in authentication/authorization.
- Feedback daemon is semi-automated — prompt optimization recommendations require human review.
- There is no test suite covering the majority of workflow steps individually.
