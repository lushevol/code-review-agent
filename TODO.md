# TODO

## Required For Live PR Review

- [-] Provide `ADO_TOKEN` in `.env` (entry exists; user reports token is in global env).
- [x] Configure OpenAI-compatible model endpoint — `openai-client.ts` reads `OPENAI_BASE_URL` + `OPENAI_API_KEY` from env.
- [x] Provide runtime `AgentConfigCreationOptions` via `.env` — `demo.ts` reads `ADO_ORGANIZATION`, `ADO_PROJECT`, `ADO_CONFIG_REPO`, `ADO_CONFIG_BRANCH`, `ADO_CONFIG_BASE_PATH`.
- [ ] Ensure the config repository (`example-repo` on ADO) contains a valid `config.json` and prompt markdown files for:
  - `review`
  - `review-rescore`
  - `issue-classification`
  - `summary`
- [ ] Confirm `scanRepoNames`, `scanPRCreatedDaysAgo`, `filePathsAllowlist`, and `filePathsBlocklist` in the config repo's `config.json` before running live scans.
- [ ] Fill `DEEPSEEK_OPENAI_BASE_URL` and `DEEPSEEK_API_KEY` in `.env` (user reports these are in global env — `.env` references them via `${}` expansion).

## Optional Integrations

- [ ] Provide `SONARQUBE_TOKEN` in `.env` if SonarQube PR measures should be included.
- [x] Provide `DATABASE_URL` — PostgreSQL 18 (brew), `code_review` DB created, all 4 tables pushed.
- [x] Confirm PostgreSQL schema — `ratan_code_review_agent` schema with `pull_request_review`, `reviewed_issues`, `reviewed_issues_tracking`, `summary`. FK bug fixed (`pr_review_id` now references `id` not `pr_id`).

## Safe Runbook

- [ ] `pnpm install --frozen-lockfile`
- [x] `pnpm build`
- [ ] `pnpm test`
- [ ] `pnpm agent:mastra:build`
- [ ] `pnpm agent:start`
- [ ] `curl http://localhost:4111/api`
- [ ] Run `pnpm agent:dev` or `pnpm agent:demo` only when live ADO side effects are intended.

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
