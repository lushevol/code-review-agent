# Project Analysis

## Summary

`ratan-code-review-agent` is a TypeScript package that automates company pull request reviews. It scans Azure DevOps repositories for active pull requests, fetches PR details and diffs, runs Mastra LLM agents to find issues and summarize changes, enriches the output with SonarQube measures when available, and posts review comments back to Azure DevOps.

The project is structured as a reusable package with exported `startup`, `mastra`, and shared Mastra types. The README describes installation and manual setup, while source code contains the operational flow and evaluation scaffolding.

## Primary Capabilities

- Scans Azure DevOps repositories using include patterns from root config.
- Filters PRs by creation window, validity, and whether the agent has already commented.
- Fetches full PR details, code diffs, comments, properties, and latest iteration metadata.
- Masks sensitive credentials in diffs before prompting review agents.
- Filters deleted files and allowlist/blocklist paths before review.
- Runs a review workflow with issue detection, confidence filtering, rescoring, second filtering, and category classification.
- Runs summary and SonarQube steps in parallel with issue review.
- Posts inline code comments and a main PR summary comment.
- Stores the reviewed PR iteration id to support incremental future reviews.
- Provides early evaluation schemas and fixtures for regression testing review quality.

## Architecture

The public entry point in `src/index.ts` exports:

- `startup` from `src/bootstrap/index.ts`
- `mastra` from `src/mastra/index.ts`
- shared types from `src/mastra/types`

Runtime work starts in `startup`. It creates an `agent-config-manager` session, scans for pending PRs, and starts a Mastra `prReviewWorkflow` run for each pending PR. Each run receives only a `configSessionId` in runtime context; steps use that id to recover the configured ADO and SonarQube clients.

The Mastra instance registers one workflow and five agents:

- `codeReviewAgent`
- `codeReviewRescoreAgent`
- `codeReviewIssueClassificationAgent`
- `codeChangeSummaryAgent`
- `codeReviewEvaluationJudgeAgent`

Storage is configured as in-memory LibSQL, logging uses `PinoLogger`, and Mastra telemetry/observability are disabled by default.

## Workflow

`pr-review-workflow` accepts:

```json
{
  "prId": 12345
}
```

It executes:

1. `fetch-pr-details`: fetches PR details through the ADO client.
2. Parallel branch:
   - `pr-review-issues-workflow`
   - `code-summary`
   - `sonarqube-measures`
3. `comment-review-results`: posts inline comments and a main PR comment.

`pr-review-issues-workflow` executes:

1. `locate-pr-changes`
2. `code-review`
3. `filter-issues`
4. `code-review-rescore`
5. `filter-issues`
6. `code-review-issue-classification`

The final workflow output is intended to include comment identifiers, although the top-level workflow schema currently declares `activities: string`. Keep this schema in mind when adding typed callers or tests.

## Data Contracts

Main review issue schema:

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

Classified issues add:

```ts
{
  category: string;
  sub_category: string;
}
```

The confidence filter keeps only issues with `confidence_score >= 0.8`.

## Runtime Dependencies

External package dependencies include:

- `@mastra/core`, `mastra`, `@mastra/libsql`, `@mastra/loggers`, `@mastra/memory`
- `@ai-sdk/openai`, `openai`, `ai`
- `zod`
- `rxjs`
- `minimatch`
- `redact-pii`
- `agent-config-manager`
- `ratan-ado-api`
- `ratan-sonarqube-api`

The last three are workspace/internal dependencies and must be available to install, build, and run the package.

## Configuration

The README expects environment values at the project root:

```env
GENAISCRIPT_MODEL_LARGE=github_copilot_chat:gpt-4.1
ADO_TOKEN=your_ado_token_here
SONARQUBE_TOKEN=your_sonarqube_token_here
```

`src/demo.ts` also reads:

```env
DATABASE_URL=...
```

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

- The model endpoint is hard-coded in `src/mastra/agents/openai-client.ts` to `http://localhost:1218/v1`.
- The API key is set to an empty string in code, so endpoint authentication assumptions are implicit.
- `locate-pr-changes` appears to calculate filtered/masked `codeChangesArray` but returns the original `codeDiffsArray`; this may bypass allowlist/blocklist or incremental filtering.
- Inline comment failures are swallowed silently in `comment.ts`.
- The workflow output schema does not match the shape returned by the final `comment` step.
- There is no test suite covering the workflow steps.
- This directory is not currently inside a Git repository in the provided workspace, so change tracking and commits are unavailable here.
