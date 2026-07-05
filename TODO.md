# TODO

## Required For Live PR Review

- [x] Provide `ADO_TOKEN` at runtime. Current local `.env` has the required key set; do not print or commit secret values.
- [x] Configure OpenAI-compatible model endpoint — `openai-client.ts` reads `OPENAI_BASE_URL` + `OPENAI_API_KEY` from env (previously hardcoded).
- [x] Provide runtime `AgentConfigCreationOptions` via `.env`/CLI — `demo.ts` and the CLI read `ADO_ORGANIZATION`, `ADO_PROJECT`, `ADO_CONFIG_REPO`, `ADO_CONFIG_BRANCH`, `ADO_CONFIG_BASE_PATH`, and `ADO_PROXY_URL`.
- [x] Add direct/proxy ADO configuration support — use `ADO_PROXY_URL=none` or `--ado-proxy-url none` for direct ADO access on user machines.
- [x] Correct the configured ADO config repo/path/branch so `ratan-code-review doctor` can load `config.json`.
- [x] Ensure the config repository contains a valid starter `config.json` and prompt markdown files for:
  - `review`
  - `review-rescore`
  - `issue-classification`
  - `summary`
- [ ] Confirm `scanRepoNames`, `scanPRCreatedDaysAgo`, `filePathsAllowlist`, and `filePathsBlocklist` in the config repo's `config.json` before running live scans.
- [ ] Confirm model env values (`OPENAI_BASE_URL`, `OPENAI_API_KEY`, or equivalent local OpenAI-compatible endpoint) on the machine that will run the CLI.

## Optional Integrations

- [ ] Provide `SONARQUBE_TOKEN` in `.env` if SonarQube PR measures should be included.
- [x] Provide `DATABASE_URL` — PostgreSQL 18 (brew), `code_review` DB created, all 4 tables pushed.
- [x] Confirm PostgreSQL schema — `ratan_code_review_agent` schema with `pull_request_review`, `reviewed_issues`, `reviewed_issues_tracking`, `summary`. FK bug fixed (`pr_review_id` now references `id` not `pr_id`).

## Safe Runbook

- [ ] `pnpm install --frozen-lockfile`
- [x] `pnpm build` — latest verification passed (v2).
- [x] `pnpm test` — latest verification passed: 10 test files, ~134+ tests (up from 4/32 in v1).
- [x] `pnpm -r pack --pack-destination /tmp/code-review-agent-packs` — latest verification created tarballs for publishable workspaces.
- [x] `npm publish --dry-run /tmp/code-review-agent-packs/ratan-code-review-0.1.0.tgz` — latest verification passed for the CLI package.
- [x] Install packed CLI into a clean local macOS consumer project and run `ratan-code-review --help`.
- [x] `pnpm agent:mastra:build` — verified in v1; rerun before release if artifacts have changed.
- [x] `pnpm agent:start` — previously verified to reach `Mastra API running` at `http://localhost:4111/api`; rerun before release if artifacts have changed.
- [ ] `curl http://localhost:4111/api` after starting the Mastra server.
- [ ] Verify FindingStore SQLite database initializes correctly in `.ratan/code-review-agent/findings.db`.
- [ ] Verify webhook receiver starts and HMAC validation works.
- [ ] Verify dashboard starts and serves API + React SPA.
- [ ] Run `ratan-code-review scan` only when live ADO side effects are intended.

## Azure DevOps MCP

- [x] Add a Codex global MCP server named `azure-devops`.
- [x] Add `scripts/ado-mcp.sh` launcher that reads `.env`, derives `PERSONAL_ACCESS_TOKEN` from `ADO_TOKEN`, and starts `npx -y @azure-devops/mcp "$ADO_ORGANIZATION" --authentication pat`.
- [x] Smoke-test the MCP server startup and tool listing. It starts for organization `lushe` and exposes Azure DevOps MCP tools.
- [x] Use ADO MCP to verify the config repo and read back `/code-review-agent/config.json`.
- [ ] Restart Codex or open a new Codex session so the newly registered MCP server tools are loaded into the current tool runtime.
- [ ] After restart, verify the actual exposed MCP tools from inside Codex and use them for read-only ADO checks before making write changes.
- [ ] Confirm the target ADO review repo, branch, and write policy before using MCP tools to modify application code in Azure DevOps.

## CLI Publish And User-Machine Verification

- [x] Make `ratan-code-review` publishable as an npm CLI package with `bin`.
- [x] Add CLI commands:
  - `ratan-code-review scan` for live PR scanning/review.
- [x] Make transitive workspace package `ratan-code-review-agent-orm` publishable.
- [x] Verify npm publish dry-run for the CLI package.
- [x] Verify packed CLI install and `--help` on local macOS.
- [ ] Publish all required internal packages to the intended npm registry.
- [ ] Install from the actual registry on another macOS machine and run `ratan-code-review --help`.
- [ ] Install from the actual registry on Windows 11 and run `ratan-code-review --help`.
- [ ] Run `ratan-code-review scan` on the target user's machine with its real ADO/proxy settings.
- [ ] Run a controlled live review against a dedicated test PR and confirm the expected ADO comments/properties are created.

## PR Guardian Copilot v2 Follow-Ups

### Scanner Pipeline
- [ ] Verify AIReviewScanner rescore/classify mapping to NormalizedFinding is correct.
- [ ] Verify CveScanner error handling — non-fatal on missing SonarQube client or network failure.
- [ ] Verify compliance engine YAML rule loading and merging.
- [ ] Add scanner unit tests for edge cases (empty diffs, binary files, very large files).
- [ ] Verify scanner pipeline integration test covers correlation and dedup scenarios.

### Finding Store
- [ ] Verify FindingStore dedup by content hash works across scanner outputs.
- [ ] Verify FindingStore override resolution with expiry.
- [ ] Verify audit trail append-only constraint.
- [ ] Add FindingStore migration path for schema changes.

### Merge Governance
- [ ] Verify merge-gate policy evaluates multiple dimensions (critical CVE, failed compliance, severe AI issues).
- [ ] Verify merge-gate sets correct ADO PR status.
- [ ] Test merge-gate error handling (non-fatal).

### Webhooks
- [ ] Verify HMAC-SHA256 signature validation.
- [ ] Verify dedup window (5 min) prevents duplicate processing.
- [ ] Verify auto-registration of ADO subscriptions.
- [ ] Test webhook server recovery after restart.
- [ ] Add webhook server graceful shutdown.

### Dashboard
- [ ] Verify dashboard API endpoints return correct data.
- [ ] Verify React SPA builds and serves correctly.
- [ ] Verify dashboard authentication/authorization (if applicable).

### Re-review
- [ ] Verify `reconcileFindings()` handles content-hash matching correctly.
- [ ] Verify fallback location-based matching.
- [ ] Verify review-tracker iteration tracking across PR updates.

### Feedback Daemon
- [ ] Verify daemon collects ADO comment reactions.
- [ ] Verify false-positive pattern aggregation.
- [ ] Verify prompt optimization recommendations are useful.

## Design Follow-Ups

- [x] Move the LLM base URL, model name, and API key out of source code and into environment/runtime config.
- [ ] Align `pr-review-workflow` output schema with the actual `comment-review-results` step output.
- [ ] Add workflow-step tests for:
  - `fetch-pr-details`
  - `fetch-workitem-context`
  - `locate-pr-changes`
  - `code-review`
  - `filter-issues`
  - `code-review-rescore`
  - `code-review-issue-classification`
  - `scanner-pipeline`
  - `merge-gate`
  - `create-workitems`
  - `comment-review-results`
- [ ] Verify whether `locate-pr-changes` should return the filtered/masked `codeChangesArray` instead of the original `codeDiffsArray`.
- [ ] Make inline comment failure handling observable instead of silently swallowing per-line comment failures.
- [ ] Implement or remove `startupEvaluation`; it currently logs that evaluation mode is not implemented.
- [ ] Implement `src/evaluation/scorer.ts` or document why evaluation scoring is deferred.
- [ ] Consider replacing deprecated `request` if the `redact-pii` dependency chain can be upgraded or removed.
- [ ] Move FindingStore from SQLite to Drizzle ORM for PostgreSQL parity (if needed for scale).

## Runtime Compatibility Follow-Ups

- [ ] Track Mastra/protobufjs compatibility with Node 24.
- [ ] Remove `scripts/protobufjs-esm-loader.mjs` if a future Mastra/protobufjs version emits Node-compatible ESM imports.
- [ ] Revisit `PNPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS=true` in `mastra:build` if Mastra starts copying workspace-level `allowBuilds` into generated artifacts.
