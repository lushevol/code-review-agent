# Code Review Agent

AI-powered Azure DevOps pull request review agent built as a pnpm workspace.

## Packages

| Workspace | Location | Purpose |
| --- | --- | --- |
| `ratan-code-review-agent` | `agents/ratan-code-review-agent` | Mastra workflows, agents, bootstrap, and evaluation code |
| `agent-config-manager` | `packages/agent-config-manager` | Runtime config and prompt loading from Azure DevOps |
| `ratan-ado-api` | `packages/ratan-ado-api` | Azure DevOps API client |
| `ratan-code-review-agent-orm` | `packages/ratan-code-review-agent-orm` | Drizzle ORM tables and repository helpers |
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
```

Do not run them without a valid `ADO_TOKEN` and explicit intent to scan PRs and post review comments.

## Environment

Required for live operation:

```bash
ADO_TOKEN=your_azure_devops_pat
```

Optional:

```bash
SONARQUBE_TOKEN=your_sonarqube_token
DATABASE_URL=postgres_connection_string
```

The LLM endpoint is currently configured in `agents/ratan-code-review-agent/src/mastra/agents/openai-client.ts` as `http://localhost:1218/v1` with an empty API key.

## Runtime Compatibility

`ratan-code-review-agent start` uses `scripts/protobufjs-esm-loader.mjs` because the Mastra artifact externalizes `protobufjs`, and Node 24 requires explicit file and JSON import handling for some `protobufjs` subpaths emitted into the generated ESM bundle.

## Architecture Notes

Runtime architecture and current design risks are documented in:

- `agents/ratan-code-review-agent/docs/RUNTIME_ARCHITECTURE.md`
- `agents/ratan-code-review-agent/docs/PROJECT_ANALYSIS.md`
- `CLAUDE.md`
