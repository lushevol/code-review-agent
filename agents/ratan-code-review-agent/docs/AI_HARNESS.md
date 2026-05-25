# AI Harness Guide

## Purpose

Use this document as the operating guide for an AI harness that analyzes, modifies, tests, or runs `ratan-code-review-agent`.

The harness should treat this package as a PR-review automation system with real external side effects. Running the full startup or workflow can call Azure DevOps, call SonarQube, call an OpenAI-compatible model endpoint, and post comments to pull requests.

## Harness Objectives

An AI harness working on this project should be able to:

- Understand the code review workflow and its side effects.
- Modify prompts, schemas, filtering, and workflow steps safely.
- Add tests or evaluation cases without posting to live PRs.
- Run build and local validation commands when dependencies are available.
- Keep sensitive company data and credentials out of source code and logs.

## Safe Default Mode

Default to analysis and local validation. Do not run PR scanning or comment-posting code unless the user explicitly asks for live integration testing.

Safe activities:

- Read source files.
- Edit TypeScript, Markdown, schemas, and fixtures.
- Run type/build/test commands that do not require network access.
- Add unit tests with mocked `agent-config-manager`, ADO, SonarQube, and Mastra agent calls.
- Generate or update evaluation fixtures.

Side-effectful activities:

- `pnpm demo`
- `startup(...)`
- `scanPRs(...)` with real config
- `prReviewWorkflow` against a real `prId`
- any call path that reaches `addCommentThreadForPRCode`, `addCommentForPR`, or `setPullRequestProperties`

## Setup

Expected local stack:

```bash
node --version
npm --version
pnpm --version
pnpm install
```

Use pnpm 9, not pnpm 10.

Expected environment:

```env
ADO_TOKEN=...
SONARQUBE_TOKEN=...
DATABASE_URL=...
GENAISCRIPT_MODEL_LARGE=github_copilot_chat:gpt-4.1
```

The LLM client is currently configured in `src/mastra/agents/openai-client.ts`:

```ts
baseURL: "http://localhost:1218/v1"
apiKey: ""
```

If the harness needs to run agents against another endpoint, change this through a configuration refactor or a controlled environment override rather than embedding secrets.

## Validation Commands

Use these commands when dependencies are installed:

```bash
# Build all packages
pnpm build

# Run tests
pnpm test

# Build Mastra artifacts
pnpm mastra:build

# Regenerate evaluation JSON schema
pnpm codegen

# CLI usage (after build)
node bin/ratan-code-review.js --help
node bin/ratan-code-review.js init  # scaffold config
node bin/ratan-code-review.js scan  # one-shot PR scan

# Live side-effectful commands (not safe default)
pnpm dev
pnpm demo
```

`pnpm demo` is not a safe default because it starts the live PR scanning flow from `src/demo.ts`. The `scan` CLI command also has external side effects (ADO calls) and requires a valid config.

## Suggested Harness Test Strategy

Start with unit tests around pure utilities:

- `maskSensitiveData`
- `filterReviewableFiles`
- `applyConfidenceScoreFilter`
- `chunkContent`
- `sortIssues`
- `duplicate-issue-check`

Then test workflow steps with mocked runtime context and mocked clients:

- `fetch-pr-details` should call `getPullRequestById`.
- `locate-pr-changes` should mask and filter diffs.
- `code-review` should chunk diffs, build the `review` prompt, call `codeReviewAgent`, and attach file paths.
- `filter-issues` should enforce `CONFIDENCE_SCORE_THRESHOLD`.
- `code-review-rescore` should preserve issues and update only returned scores.
- `code-review-issue-classification` should add categories and default to `Uncategorized`.
- `sonarqube-measures` should return `null` on missing client or fetch errors.
- `comment-review-results` should limit inline comments to 30 and update the latest-review PR property.

Do not use real ADO or SonarQube clients in automated tests.

## Evaluation Harness

The evaluation data model lives in `src/evaluation/type.ts`.

Current fixture format:

```json
{
  "id": "tc-java-001",
  "input": {
    "codeChange": {
      "changes": "...",
      "newFilePath": "src/Example.java",
      "oldFilePath": "src/Example.java",
      "changeType": "MODIFY"
    }
  },
  "expectedOutput": {
    "issues": [
      {
        "file": "src/Example.java",
        "line": 4,
        "message": "...",
        "suggestion": "...",
        "suggestion_code": "..."
      }
    ]
  }
}
```

A complete evaluation harness should:

1. Load each fixture from `src/evaluation/dataset`.
2. Run only the review path against `input.codeChange`, not the full PR-commenting workflow.
3. Normalize actual issues to the test schema.
4. Fuzzy-match issue file and line against expected issues.
5. Use `codeReviewEvaluationJudgeAgent` only for precision and suggestion-quality checks.
6. Emit metrics matching `codeChangesReviewEvaluationResultSchema`.

## Prompt Harness

Prompt names are resolved through `agentConfig.buildPrompt(...)`.

Expected prompt keys:

- `review`
- `review-rescore`
- `issue-classification`
- `summary`

For review prompts, the review step passes path variables:

```ts
{
  repo: repoName,
  extension: extractFileExtension(change.newFilePath)
}
```

Harness tests should verify prompt inputs, but should not assume prompt text is stored in this package. Prompt content appears to come from `agent-config-manager` and external config files.

## Live Run Checklist

Before allowing live PR review:

- Confirm the target repositories and PR age window in root config.
- Confirm `ADO_TOKEN` and `SONARQUBE_TOKEN` are scoped correctly.
- Confirm the model endpoint at `http://localhost:1218/v1` is running and compatible with the AI SDK.
- Confirm the review prompts are available for `review`, `review-rescore`, `issue-classification`, and `summary`.
- Confirm allowlist/blocklist patterns.
- Confirm whether the `locate-pr-changes` return value should use filtered `codeChangesArray`.
- Run against a dedicated test PR before enabling broad scanning.

## Recommended Improvements

- Move model base URL, model name, and API key behavior to environment or agent config.
- Add a `test` script and focused Vitest tests.
- Implement `src/evaluation/scorer.ts` and `startupEvaluation`.
- Fix or confirm the `locate-pr-changes` filtered array return behavior.
- Align `pr-review-workflow` output schema with the `comment-review-results` step.
- Log inline comment failures with enough context to debug without exposing secrets.
- Add dry-run mode so the full workflow can execute without writing PR comments.
