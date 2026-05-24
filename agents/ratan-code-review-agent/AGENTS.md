# AI Agent Instructions

This package implements a Mastra-based code review agent for company pull request reviews. Treat it as an automation package that reads Azure DevOps pull requests, asks LLM agents to review and summarize diffs, optionally adds SonarQube context, and posts comments back to the PR.

## Working Rules

- Keep changes scoped to `ratan-code-review-agent` unless the caller explicitly asks for workspace-level changes.
- Prefer existing Mastra workflow and step patterns over introducing new orchestration code.
- Preserve structured outputs. Review, rescore, classification, and evaluation agents rely on Zod schemas in `src/mastra/types` and `src/evaluation/type`.
- Do not hard-code company tokens, Azure DevOps URLs, SonarQube tokens, or model credentials.
- Be careful with PR-commenting behavior. `comment-review-results` writes to Azure DevOps and updates the latest-review property.
- Before changing filtering, confidence thresholds, or masking, check the user impact: those changes can alter which issues are posted publicly to PRs.

## Repo Map

- `src/index.ts`: package exports.
- `src/bootstrap`: startup, runtime config session handling, and PR scanning.
- `src/mastra/index.ts`: Mastra instance, registered agents, workflow, in-memory storage, logging, and telemetry settings.
- `src/mastra/agents`: LLM agents for review, summary, rescore, classification, and evaluation judge.
- `src/mastra/workflows`: Mastra workflows and steps for PR review.
- `src/mastra/types`: shared Zod schemas and TypeScript types.
- `src/mastra/utils`: diff chunking, file filtering, masking, prompt formatting, sorting, and comment helpers.
- `src/evaluation`: evaluation schemas, dataset fixtures, and judge/evaluator helpers.

## Commands

- `pnpm install`: install dependencies. This package uses pnpm 9 and workspace dependencies.
- `pnpm build`: build the library through Rslib.
- `pnpm mastra:build`: build Mastra artifacts.
- `pnpm dev`: run Mastra dev mode.
- `pnpm demo`: run `src/demo.ts` with telemetry disabled and local environment values.
- `pnpm codegen`: regenerate the evaluation JSON schema.

## Runtime Assumptions

- Node.js `>=20.11.0`, npm `>=10`, and pnpm 9 are expected.
- `ADO_TOKEN` is required for Azure DevOps access.
- `SONARQUBE_TOKEN` is optional, but SonarQube measures return `null` when unavailable or failing.
- The OpenAI-compatible model endpoint is currently configured in `src/mastra/agents/openai-client.ts` as `http://localhost:1218/v1` with an empty API key.
- `startup` creates an `agent-config-manager` config session and stores only the session id in Mastra runtime context.

## Known Care Points

- The workspace dependencies `agent-config-manager`, `ratan-ado-api`, and `ratan-sonarqube-api` are required but are not defined inside this package.
- `src/mastra/workflows/steps/locate-changes.ts` builds a filtered and masked `codeChangesArray`, but returns the original `codeDiffsArray`. Verify intended behavior before relying on incremental filtering.
- `src/evaluation/scorer.ts` is currently empty, and `startupEvaluation` is a placeholder.
- Comment posting silently ignores per-line comment failures in `comment.ts`, then still posts the main PR comment.
