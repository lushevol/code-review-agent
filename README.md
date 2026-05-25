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

The installable CLI can be checked without contacting Azure DevOps:

```bash
pnpm --filter ratan-code-review-agent build
node agents/ratan-code-review-agent/dist/cli.js --help
node agents/ratan-code-review-agent/dist/cli.js doctor
pnpm --filter ratan-code-review-agent pack --pack-destination /tmp
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
ratan-code-review-agent run
```

Do not run them without a valid `ADO_TOKEN` and explicit intent to scan PRs and post review comments.

## CLI Usage

After publishing or installing the `ratan-code-review-agent` package, run:

```bash
ratan-code-review-agent run \
  --ado-token "$ADO_TOKEN" \
  --config-repo "$ADO_CONFIG_REPO" \
  --config-branch "$ADO_CONFIG_BRANCH"
```

To verify ADO credentials and the remote config repository without scanning PRs
or posting comments, run:

```bash
ratan-code-review-agent doctor \
  --ado-token "$ADO_TOKEN" \
  --config-repo "$ADO_CONFIG_REPO" \
  --config-branch "$ADO_CONFIG_BRANCH"
```

The CLI also accepts `ADO_TOKEN`, `ADO_CONFIG_REPO`, and `ADO_CONFIG_BRANCH`
from the environment. Optional ADO settings are `ADO_ORGANIZATION`,
`ADO_PROJECT`, `ADO_PROXY_URL`, and `ADO_CONFIG_BASE_PATH`; optional
integrations use `SONARQUBE_TOKEN` and `DATABASE_URL`. Set
`ADO_PROXY_URL=none` or pass `--ado-proxy-url none` when the machine should
connect to Azure DevOps directly instead of using the packaged default proxy.

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

The ADO config repository currently contains starter files under
`/code-review-agent`:

- `config.json`
- `prompts/review.md`
- `prompts/review-rescore.md`
- `prompts/issue-classification.md`
- `prompts/summary.md`

## Current Verification Status

As of the latest local verification:

- `pnpm test` passes.
- `pnpm build` passes.
- `pnpm -r pack --pack-destination /tmp/code-review-agent-packs` creates tarballs for all publishable workspaces.
- `npm publish --dry-run /tmp/code-review-agent-packs/ratan-code-review-agent-0.0.1.tgz` succeeds for the CLI package.
- Installing the packed CLI into a clean local consumer project works on macOS, and `ratan-code-review-agent --help` runs from `node_modules/.bin`.
- Read-only ADO authentication/connectivity works, `ratan-code-review-agent doctor` passes, and the configured remote prompt files load through `agent-config-manager`.

The end-to-end goal is therefore not complete yet: the starter config still needs a real `scanRepoNames` target, and a controlled live test PR review must be run before claiming full ADO review operation.

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
