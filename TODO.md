# TODO

## Required For Live PR Review

- Provide `ADO_TOKEN` with permission to read repositories, pull requests, diffs, comments, and PR properties, and to post PR comments.
- Start or configure an OpenAI-compatible model endpoint for `agents/ratan-code-review-agent/src/mastra/agents/openai-client.ts`.
  - Current hardcoded endpoint: `http://localhost:1218/v1`
  - Current API key: empty string
- Provide runtime `AgentConfigCreationOptions` when calling `startup`, including:
  - Azure DevOps organization
  - Azure DevOps project
  - config repository name
  - config branch
  - optional config base path
- Ensure the config repository contains a valid `config.json` and prompt files for:
  - `review`
  - `review-rescore`
  - `issue-classification`
  - `summary`
- Confirm `scanRepoNames`, `scanPRCreatedDaysAgo`, `filePathsAllowlist`, and `filePathsBlocklist` in config before running live scans.

## Optional Integrations

- Provide `SONARQUBE_TOKEN` if SonarQube PR measures should be included.
- Provide `DATABASE_URL` if ORM-backed persistence is required.
- Confirm the PostgreSQL schema and migrations for `ratan-code-review-agent-orm` before enabling database writes in a shared environment.

## Safe Runbook

- Use safe verification first:
  - `CI=true pnpm install --frozen-lockfile`
  - `pnpm build`
  - `pnpm test`
  - `pnpm agent:mastra:build`
  - `pnpm agent:start`
- Verify the local Mastra API after start:
  - `curl http://localhost:4111/api`
- Run `pnpm agent:dev` or `pnpm agent:demo` only when live Azure DevOps side effects are intended.

## Design Follow-Ups

- Move the LLM base URL, model name, and API key out of source code and into environment/runtime config.
- Align `pr-review-workflow` output schema with the actual `comment-review-results` step output.
- Add workflow-step tests for:
  - `fetch-pr-details`
  - `locate-pr-changes`
  - `code-review`
  - `filter-issues`
  - `code-review-rescore`
  - `code-review-issue-classification`
  - `comment-review-results`
- Verify whether `locate-pr-changes` should return the filtered/masked `codeChangesArray` instead of the original `codeDiffsArray`.
- Make inline comment failure handling observable instead of silently swallowing per-line comment failures.
- Implement or remove `startupEvaluation`; it currently logs that evaluation mode is not implemented.
- Implement `src/evaluation/scorer.ts` or document why evaluation scoring is deferred.
- Consider replacing deprecated `request` if the `redact-pii` dependency chain can be upgraded or removed.

## Runtime Compatibility Follow-Ups

- Track Mastra/protobufjs compatibility with Node 24.
- Remove `scripts/protobufjs-esm-loader.mjs` if a future Mastra/protobufjs version emits Node-compatible ESM imports.
- Revisit `PNPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS=true` in `mastra:build` if Mastra starts copying workspace-level `allowBuilds` into generated artifacts.
