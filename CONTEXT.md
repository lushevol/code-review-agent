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
The `ratan-code-review` npm package exposes two commands:
- **`start`** — Unified entry point. On first run, scaffolds `.ratan/` folder with default config and prompts from `templates/`. Reads config, initializes PR queue, runs scan loop. `--watch` for 30-min polling with background feedback daemon. `--pr-id <id>` for single PR review.
- **`dashboard`** — Starts the PR Guardian dashboard (Express REST API + React SPA)

## Finding Store
SQLite-based persistence layer in `packages/finding-store`. Stores findings, override logs, and audit records. Uses SHA-256 content hashing for finding identity across PR iterations.

## Scanner Pipeline
A set of concurrent scanners that analyze PR changes. Scanners implement a common `Scanner` interface and run via `Promise.allSettled` for graceful degradation:
- **AI Review Scanner** — LLM-based code quality review
- **CVE Scanner** — SonarQube vulnerability/security hotspot detection
- **Compliance Engine** — Static analysis rules (TODO/FIXME, console.log, large files, YAML policies)

## Merge Gate
A workflow step that evaluates blocking findings against a configured merge policy and sets the ADO PR status (`succeeded`/`failed`/`pending`) to enforce governance.

## Normalized Finding
A standardized finding object (`NormalizedFinding`) produced by all scanners. Includes: `filePath`, `lineStart`, `lineEnd`, `message`, `suggestion`, `severity` (Critical/High/Medium/Low), `category`, `engine` (ai-review/cve/compliance), `contentHash` (SHA-256), and `resolution`.

## Content Hash
SHA-256 hash of `filePath + surrounding code` used as a stable identifier for findings across PR iterations. Survives line number shifts. Fallback: location-based matching `(filePath, lineStart +/- 3, sourceEngine, category)`.

## Override Service
Manages finding resolution overrides with workflows for waive, false-positive, risk-accept. Two-person approval for critical findings. Expiry management. Full audit trail via `override_log` table.

## Audit Trail
Append-only `audit_records` table recording every review result with commit hash, engine versions, model version, and timestamp. Retention policy configurable.

## Feedback Daemon
Semi-automated background process that collects ADO comment reactions (👍/👎), aggregates false-positive patterns, and generates prompt optimization recommendations for human review.

## Webhook Service
Express receiver for ADO `git.pullrequest.created` and `git.pullrequest.updated` events. HMAC-SHA256 validation, 5-min dedup window, auto-registration of ADO subscriptions.

## PR Eligibility Gate
Checks applied before triggering a review: pilot repo inclusion, draft status, minimum PR size. Configurable via root config.

## Repo List Cache
`pr-scan.ts` caches the ADO repository list for 24 hours to reduce API calls. The cache is module-level, invalidated by TTL expiry.
