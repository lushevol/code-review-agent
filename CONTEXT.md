# Code Review Agent — Domain Glossary

## Config Mode
How the agent resolves its configuration (review rules, prompts, model settings).
- **Local mode**: Config JSON and prompt files are read from the local filesystem under `.ratan/code-review-agent/`
- **ADO mode**: Config JSON and prompt files are fetched from an Azure DevOps repository at runtime

## Config Provider
An abstraction that provides configuration from a source. Two implementations exist:
- `AgentConfigClient` — fetches from ADO repos
- `LocalConfigClient` — reads from local filesystem

Both implement the same `ConfigProvider` interface, added to `agent-config-manager` (see `docs/adr/0001-config-provider-interface.md`).

## Wrapper Config
The `.ratan/code-review-agent/config.json` file that serves as the single entry point. It declares the config mode and contains mode-specific parameters.

## Config Loader
Located at `src/cli/config/loader.ts`. Reads the wrapper config, resolves `"env:VAR_NAME"` token references to environment variables, and creates the appropriate `ConfigProvider` (local or ADO).

## CLI Commands
The `ratan-code-review` npm package exposes three commands:
- **`init`** — Scaffolds `.ratan/code-review-agent/config.json` with defaults
- **`scan`** — One-shot PR review scan (use `--watch` for 30-min interval)
- **`studio`** — Launches pre-built Mastra Studio web UI

## Repo List Cache
`pr-scan.ts` caches the ADO repository list for 24 hours to reduce API calls. The cache is module-level, invalidated by TTL expiry.
