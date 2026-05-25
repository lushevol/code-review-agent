# ratan-code-review NPM CLI Package

## Overview

Package the existing `ratan-code-review-agent` Mastra-based code review agent as a publishable npm CLI package (`ratan-code-review`) with a `ratan-code-review` binary. The CLI supports two modes of operation — local config from `.ratan/code-review-agent/` or remote config from Azure DevOps repos — and provides `scan` and `studio` commands.

## Design Decisions

### Config Wrapper Pattern

A single `.ratan/code-review-agent/config.json` file serves as the entry point for all configuration. It declares which mode to use and holds the parameters for that mode. This avoids having multiple config discovery mechanisms and gives users one place to look.

Secrets (ADO token, SonarQube token) are never stored in the config file. They reference environment variables via `"env:VAR_NAME"` syntax, resolved at load time.

### Commands

Multi-command CLI with `commander`:
- `init` — scaffold `.ratan/code-review-agent/config.json` with default local-mode template
- `scan` — runs the PR review workflow (wraps existing `startup()`)
- `studio` — launches Mastra Studio web UI

### Config Provider Interface

The design adds a `ConfigProvider` interface to `agent-config-manager/src/types.ts`. Both `AgentConfigClient` (existing, ADO-backed) and `LocalConfigClient` (new, filesystem-backed) implement it. `AgentConfigSession` stores `ConfigProvider` instead of `AgentConfigClient`, and `extractAgentConfig` returns `ConfigProvider`. The CLI's `loader.ts` constructs the right provider based on the wrapper config's `mode` field.

### Minimal Changes to Existing Code

The CLI is additive (new `src/cli/` directory). The `agent-config-manager` package gets the `ConfigProvider` interface, the `AgentConfigClient` updated to implement it, and the `AgentConfigSession` updated to store `ConfigProvider`. Core workflow, agent definitions, and utility code are untouched.

## Architecture

### Package Layout

```
ratan-code-review (was ratan-code-review-agent, published as ratan-code-review)
├── bin/
│   └── ratan-code-review.js    ← Shebang shim: "#!/usr/bin/env node" + import from dist
├── src/
│   ├── cli/
│   │   ├── index.ts            ← bin entry: commander setup, command registration
│   │   ├── commands/
│   │   │   ├── scan.ts         ← scan command handler
│   │   │   └── studio.ts       ← studio command handler (runs pre-built .mastra/output)
│   │   └── config/
│   │       ├── loader.ts       ← reads wrapper config, resolves env tokens
│   │       └── local-client.ts ← LocalConfigClient (filesystem-backed config provider)
│   ├── bootstrap/…             ← unchanged
│   ├── mastra/…                ← unchanged
│   └── index.ts                ← unchanged (library exports)
├── package.json
├── rslib.config.ts             ← updated with banner for CLI entry
└── tsconfig.json               ← unchanged
```

### Config Schema

```typescript
// .ratan/code-review-agent/config.json
interface WrapperConfig {
  mode: "local" | "ado";

  ado: {
    organization: string;
    project: string;
    token?: string;          // inline or "env:VAR_NAME"
  };

  sonarQubeToken?: string;   // inline or "env:VAR_NAME"
  databaseUrl?: string;      // inline or "env:VAR_NAME"

  // Local mode fields
  config?: RootAgentConfig;  // same schema as ADO config.json

  // ADO mode fields
  configRepo?: string;
  configBranch?: string;
  configBasePath?: string;
}
```

### CLI Usage

```
ratan-code-review init                       # scaffold default config
ratan-code-review scan                       # one-shot scan
ratan-code-review scan --watch               # continuous (30min interval)
ratan-code-review scan --config ./custom     # custom config path
ratan-code-review studio                     # launch Mastra Studio
ratan-code-review studio --port 3456         # custom port
ratan-code-review --help
```

### ConfigProvider Interface

```typescript
interface ConfigProvider {
  getRootConfig(): Promise<RootAgentConfig>;
  getAgentConfig(agentName: string): Promise<AgentConfig>;
  buildPrompt(promptKey: string, context?: PromptContext): Promise<string>;
  getAdoClient(): AzureDevOps;
  getSonarQubeClient(): SonarQubeClient;
  getOrmClient(): Promise<...>;
  connect(): Promise<void>;
}
```

### LocalConfigClient

Reads `RootAgentConfig` directly from the wrapper config's `config` field. Reads prompt `.md` files from the local filesystem (relative to `.ratan/code-review-agent/`). Supports the same Handlebars interpolation for path variables (`{{repo}}`, `{{extension}}`) and content variables (`{{diff}}`) as ADO mode. Creates ADO client for PR fetching when `connect()` is called with the ADO token resolved from env. No file caching needed — local filesystem reads are fast enough without it.

### Scan Optimization

The PR scan flow adds a 24-hour in-memory cache for the ADO repo list. This prevents unnecessary `getRepos()` API calls on every scan iteration, especially in `--watch` mode. The repo list is stable — it rarely changes within a day. Cache is per-process (not persisted), so restarts get a fresh list.

### CLI Scan Behavior

- `ratan-code-review scan` — one-shot scan: fetches repo list (cached 24h), scans for pending PRs, reviews them, exits
- `ratan-code-review scan --watch` — continuous mode: scans every 30 minutes, repo list cached 24h across iterations

### Studio Command

The `studio` command starts the Mastra Studio web UI from a pre-built `.mastra/output/` directory. This directory is **built at publish time** (via `mastra build` in prepublish) and shipped with the package. No runtime `mastra` CLI dependency needed.

When the user runs `ratan-code-review studio`:
1. It starts the compiled Mastra server: `node --loader=./scripts/protobufjs-esm-loader.mjs --import=./.mastra/output/instrumentation.mjs .mastra/output/index.mjs`
2. This serves both the Mastra Studio web UI and the agent API
3. The user opens `http://localhost:PORT` in their browser

If `.mastra/output/` is missing (dev/build issue), `studio` prints a clear error instructing the user to reinstall or rebuild.

### Build & Packaging

- `rslib.config.ts`: disable minify for better user stack traces; no banner needed since the shebang lives in the `bin/` shim
- `package.json`: add `bin` field pointing to `bin/ratan-code-review.js`, remove `private`, set `files: ["dist", "bin", ".mastra"]`, add `"prepublish": "pnpm build && pnpm mastra:build"`
- The `bin/ratan-code-review.js` shim handles the shebang (`#!/usr/bin/env node`) and re-exports from the compiled `dist/cli/index.js` — more reliable than relying on the bundler to preserve the shebang
- Publish: `pnbuild && npm publish` (prepublish hook runs build + mastra:build automatically)
- New dependency: `commander` (lightweight CLI parser)

### .ratan/code-review-agent/ Directory Layout

```
.ratan/code-review-agent/
├── config.json          ← wrapper config (required)
└── prompts/             ← prompt markdown files (local mode only)
    ├── review/
    │   ├── principles.md
    │   └── project.md
    └── summary/
        └── instructions.md
```

## Files Changed

| File | Change |
|------|--------|
| `agents/ratan-code-review-agent/package.json` | Remove `private`, add `bin`, add `commander` dep, update `files` |
| `agents/ratan-code-review-agent/rslib.config.ts` | Disable minification for debug-friendly stack traces |
| `agents/ratan-code-review-agent/src/cli/index.ts` | **New** — CLI entry point |
| `agents/ratan-code-review-agent/src/cli/commands/scan.ts` | **New** — scan command |
| `agents/ratan-code-review-agent/src/cli/commands/studio.ts` | **New** — studio command |
| `agents/ratan-code-review-agent/src/cli/config/loader.ts` | **New** — config loader |
| `agents/ratan-code-review-agent/src/cli/config/local-client.ts` | **New** — LocalConfigClient |
| `agents/ratan-code-review-agent/bin/ratan-code-review.js` | **New** — shebang shim |
| `packages/agent-config-manager/src/types.ts` | Add `ConfigProvider` interface |
| `packages/agent-config-manager/src/config.ts` | `AgentConfigClient` implements `ConfigProvider` |
| `packages/agent-config-manager/src/session.ts` | `AgentSession.config` typed as `ConfigProvider` |

## Out of Scope

- E2E tests for the CLI (manual smoke test before publish)
- CI/CD pipeline for npm publishing
- Windows-specific path handling (Node path.resolve works cross-platform, but `mastra dev` may have issues)
