# TODO

## Required For Live PR Review

- [x] Provide `ADO_TOKEN` at runtime. Current local `.env` has the required key set; do not print or commit secret values.
- [x] Configure OpenAI-compatible model endpoint — `openai-client.ts` reads `OPENAI_BASE_URL` + `OPENAI_API_KEY` from env.
- [x] Provide runtime `AgentConfigCreationOptions` via `.env`/CLI — `demo.ts` and the CLI read `ADO_ORGANIZATION`, `ADO_PROJECT`, `ADO_CONFIG_REPO`, `ADO_CONFIG_BRANCH`, `ADO_CONFIG_BASE_PATH`, and `ADO_PROXY_URL`.
- [x] Add direct/proxy ADO configuration support — use `ADO_PROXY_URL=none` or `--ado-proxy-url none` for direct ADO access on user machines.
- [x] Correct the configured ADO config repo/path/branch so `ratan-code-review-agent doctor` can load `config.json`.
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
- [x] `pnpm build` — latest verification passed.
- [x] `pnpm test` — latest verification passed: 4 test files, 32 tests.
- [x] `pnpm -r pack --pack-destination /tmp/code-review-agent-packs` — latest verification created tarballs for publishable workspaces.
- [x] `npm publish --dry-run /tmp/code-review-agent-packs/ratan-code-review-agent-0.0.1.tgz` — latest verification passed for the CLI package.
- [x] Install packed CLI into a clean local macOS consumer project and run `ratan-code-review-agent --help`.
- [x] `pnpm agent:mastra:build` — previously verified; rerun before release if artifacts have changed.
- [x] `pnpm agent:start` — previously verified to reach `Mastra API running` at `http://localhost:4111/api`; rerun before release if artifacts have changed.
- [ ] `curl http://localhost:4111/api` after starting the Mastra server.
- [x] `ratan-code-review-agent doctor` succeeds against the intended ADO config repo/path.
- [ ] Run `ratan-code-review-agent run`, `pnpm agent:dev`, or `pnpm agent:demo` only when live ADO side effects are intended.

## Azure DevOps MCP

- [x] Add a Codex global MCP server named `azure-devops`.
- [x] Add `scripts/ado-mcp.sh` launcher that reads `.env`, derives `PERSONAL_ACCESS_TOKEN` from `ADO_TOKEN`, and starts `npx -y @azure-devops/mcp "$ADO_ORGANIZATION" --authentication pat`.
- [x] Smoke-test the MCP server startup and tool listing. It starts for organization `lushe` and exposes Azure DevOps MCP tools.
- [x] Use ADO MCP to verify the config repo and read back `/code-review-agent/config.json`.
- [ ] Restart Codex or open a new Codex session so the newly registered MCP server tools are loaded into the current tool runtime.
- [ ] After restart, verify the actual exposed MCP tools from inside Codex and use them for read-only ADO checks before making write changes.
- [ ] Confirm the target ADO review repo, branch, and write policy before using MCP tools to modify application code in Azure DevOps.

## CLI Publish And User-Machine Verification

- [x] Make `ratan-code-review-agent` publishable as an npm CLI package with `bin`.
- [x] Add CLI commands:
  - `ratan-code-review-agent doctor` for read-only ADO/config validation.
  - `ratan-code-review-agent run` for live PR scanning/review.
- [x] Make transitive workspace package `ratan-code-review-agent-orm` publishable.
- [x] Verify npm publish dry-run for the CLI package.
- [x] Verify packed CLI install and `--help` on local macOS.
- [ ] Publish all required internal packages to the intended npm registry.
- [ ] Install from the actual registry on another macOS machine and run `ratan-code-review-agent --help`.
- [ ] Install from the actual registry on Windows 11 and run `ratan-code-review-agent --help`.
- [ ] Run `ratan-code-review-agent doctor` on the target user's machine with its real ADO/proxy settings.
- [ ] Run a controlled live review against a dedicated test PR and confirm the expected ADO comments/properties are created.

## Design Follow-Ups

- [x] Move the LLM base URL, model name, and API key out of source code and into environment/runtime config.
- [ ] Align `pr-review-workflow` output schema with the actual `comment-review-results` step output.
- [ ] Add workflow-step tests for:
  - `fetch-pr-details`
  - `locate-pr-changes`
  - `code-review`
  - `filter-issues`
  - `code-review-rescore`
  - `code-review-issue-classification`
  - `comment-review-results`
- [ ] Verify whether `locate-pr-changes` should return the filtered/masked `codeChangesArray` instead of the original `codeDiffsArray`.
- [ ] Make inline comment failure handling observable instead of silently swallowing per-line comment failures.
- [ ] Implement or remove `startupEvaluation`; it currently logs that evaluation mode is not implemented.
- [ ] Implement `src/evaluation/scorer.ts` or document why evaluation scoring is deferred.
- [ ] Consider replacing deprecated `request` if the `redact-pii` dependency chain can be upgraded or removed.

## Runtime Compatibility Follow-Ups

- [ ] Track Mastra/protobufjs compatibility with Node 24.
- [ ] Remove `scripts/protobufjs-esm-loader.mjs` if a future Mastra/protobufjs version emits Node-compatible ESM imports.
- [ ] Revisit `PNPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS=true` in `mastra:build` if Mastra starts copying workspace-level `allowBuilds` into generated artifacts.
