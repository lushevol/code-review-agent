# ratan-code-review NPM CLI Package

## Overview

Package the existing `ratan-code-review-agent` Mastra-based code review agent as a publishable npm CLI package (`ratan-code-review`) with a `ratan-code-review` binary. The CLI supports two modes of operation — local config from `.ratan/code-review-agent/` or remote config from Azure DevOps repos — and provides `scan` and `studio` commands.

## Design Decisions

### Config Wrapper Pattern

A single `.ratan/code-review-agent/config.json` file serves as the entry point for all configuration. It declares which mode to use and holds the parameters for that mode. This avoids having multiple config discovery mechanisms and gives users one place to look.

Secrets (ADO token, SonarQube token) are never stored in the config file. They reference environment variables via `"env:VAR_NAME"` syntax, resolved at load time.

### Commands

Multi-command CLI with `commander`:
- `scan` — runs the PR review workflow (wraps existing `startup()`)
- `studio` — launches Mastra Studio web UI

### Config Provider Interface

Rather than duplicating the session/connection logic, the design introduces a `ConfigProvider` interface in `agent-config-manager`. Both `AgentConfigClient` (existing, ADO-backed) and `LocalConfigClient` (new, filesystem-backed) implement it. The existing `AgentConfigSession` and workflow steps continue working unchanged.

### Minimal Changes to Existing Code

No existing source files need rewriting. The CLI is additive (new `src/cli/` directory). The `agent-config-manager` package gets the `ConfigProvider` interface and `LocalConfigClient` class added. Core workflow, agent definitions, and utility code are untouched.

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
│   │   │   └── studio.ts       ← studio command handler (spawns mastra dev)
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
  promptsPath?: string;      // relative to config dir, default "prompts"

  // ADO mode fields
  configRepo?: string;
  configBranch?: string;
  configBasePath?: string;
}
```

### CLI Usage

```
ratan-code-review scan                    # default config path
ratan-code-review scan --config ./custom  # custom config path
ratan-code-review scan --ado-mode         # force ADO mode
ratan-code-review studio                  # launch Mastra Studio
ratan-code-review studio --port 3456      # custom port
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

Reads `RootAgentConfig` directly from the wrapper config's `config` field. Reads prompt `.md` files from the local filesystem (relative to `.ratan/code-review-agent/`). Creates ADO client for PR fetching when `connect()` is called with the ADO token resolved from env.

### Studio Command

Resolves `mastra` from the package's `node_modules/.bin/mastra` and spawns `mastra dev` as a child process with inherited stdio. Loads config first to set up environment variables (ADO token, etc.) for the Mastra process.

### Build & Packaging

- `rslib.config.ts`: disable minify for better user stack traces; no banner needed since the shebang lives in the `bin/` shim
- `package.json`: add `bin` field pointing to `bin/ratan-code-review.js`, remove `private`, set `files: ["dist", "bin"]`
- The `bin/ratan-code-review.js` shim handles the shebang (`#!/usr/bin/env node`) and re-exports from the compiled `dist/cli/index.js` — more reliable than relying on the bundler to preserve the shebang
- Publish: `pnpm build && npm publish`
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
| `agents/ratan-code-review-agent/bin/ratan-code-review.js` | **New** — shebang shim |
| `packages/agent-config-manager/src/types.ts` | Add `ConfigProvider` interface |
| `packages/agent-config-manager/src/config.ts` | Implement `ConfigProvider` on existing class |

## Out of Scope

- E2E tests for the CLI (manual smoke test before publish)
- CI/CD pipeline for npm publishing
- Windows-specific path handling (Node path.resolve works cross-platform, but `mastra dev` may have issues)
