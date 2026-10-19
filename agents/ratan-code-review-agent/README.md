# ratan-code-review

`ratan-code-review` is an Azure DevOps pull-request governance CLI. It reviews
changed code with OpenCodeReview, combines optional security and compliance
scans, stores findings in SQLite, and publishes the result back to Azure DevOps.
It also includes a dashboard and a small TypeScript API for embedding a review
in another service.

## What it does

- Reviews pull-request diffs with the configured OpenCodeReview model.
- Runs optional SonarQube vulnerability/security-hotspot and compliance scans.
- Deduplicates and persists findings across review iterations.
- Applies merge policy and quality gates, then sets the Azure DevOps PR status.
- Posts prioritized inline comments and one current summary comment.
- Refreshes developer feedback and can create Azure DevOps work items for severe findings.
- Provides a local dashboard for findings, pull requests, audit records, and overrides.
- Masks sensitive changed text in a temporary repository before sending it to the LLM.

OpenCodeReview is the only production LLM review engine. SonarQube and the
compliance scanner are optional and can degrade independently when unavailable.

## Requirements

- Node.js 20 or newer
- An Azure DevOps personal access token with access to the repositories you want to review
- An OpenAI-compatible or Anthropic-compatible OpenCodeReview endpoint and model
- Git on `PATH` (required for workspace preparation and sensitive-data masking)
- SonarQube access only when CVE scanning is enabled

## Install

Install the CLI globally:

```bash
npm install --global ratan-code-review
ratan-code-review --help
```

Or install it in an application that uses the programmatic API:

```bash
npm install ratan-code-review
```

## Configure

Run `start` once from the directory where you want the agent state. The command
creates `.ratan/config.json`, `.ratan/opencodereview/rule.json`, a SQLite data
directory, and a log directory:

```bash
ratan-code-review start
```

The first run may stop at the readiness check until you fill in the required
Azure DevOps and LLM settings.

Edit `.ratan/config.json` before running a real review. A minimal configuration
looks like this:

```json
{
  "ado": {
    "organization": "your-organization",
    "project": "your-project",
    "token": "env:ADO_TOKEN"
  },
  "openCodeReview": {
    "rulesPath": "opencodereview/rule.json",
    "llm": {
      "url": "https://llm.example.com/v1",
      "token": "env:OCR_LLM_TOKEN",
      "model": "your-review-model",
      "protocol": "openai"
    }
  }
}
```

Set the referenced secrets in the process environment. Values using
`env:NAME` are resolved when the configuration is loaded:

```bash
export ADO_TOKEN="your-azure-devops-token"
export OCR_LLM_TOKEN="your-llm-token"
# Optional, when scannerSettings.cve.enabled is true:
export SONARQUBE_TOKEN="your-sonarqube-token"
```

The generated native rule file controls OpenCodeReview review behavior. Keep
the configured `rulesPath` relative to the `.ratan` directory unless you have a
specific reason to use another path.

## Run reviews

Review one pull request and wait for the result:

```bash
ratan-code-review start --pr-id 123
```

Start automatic scanning of eligible pull requests:

```bash
ratan-code-review start
```

Keep scanning on the configured interval (30 minutes by default) and run the
background feedback synchronizer:

```bash
ratan-code-review start --watch
```

Use a different configuration directory or repository filter when needed:

```bash
ratan-code-review start --config ./review-config
ratan-code-review start --repo-pattern "team-*" "service-api"
```

Reviews can write Azure DevOps comments, statuses, and work items. Test with a
dedicated repository and scoped credentials before enabling watch mode.

## Open the dashboard

Start the local dashboard:

```bash
ratan-code-review dashboard
```

Open <http://127.0.0.1:3099>. Override the port from the command line:

```bash
ratan-code-review dashboard --port 3000
```

The dashboard binds to loopback by default. To expose it on another interface,
configure HTTP Basic credentials and put it behind TLS:

```json
{
  "dashboard": {
    "host": "0.0.0.0",
    "port": 3099,
    "auth": {
      "username": "operator",
      "password": "env:DASHBOARD_PASSWORD"
    }
  }
}
```

The dashboard reads the same FindingStore used by reviews. Use
`--finding-store /path/to/findings.db` to inspect another database.

## Programmatic API

The package root exports `startReviewPrWithProvider`, normalized-finding schemas,
types, and finding hash/id helpers. A host application supplies a
`ConfigProvider` and a pull-request ID:

```ts
import { startReviewPrWithProvider } from "ratan-code-review";

await startReviewPrWithProvider(configProvider, 123);
```

TypeScript declarations are included. Workflow internals, scanners, dashboard
services, and persistence implementations are not part of the public root API.

## Data and operations

- Findings and audit records are stored at `.ratan/data/findings.db` by default.
- Logs are written under `.ratan/logs` and redact secret-like values.
- A newer review supersedes stale output for the same pull request.
- A failed optional scanner does not prevent the other scanners from running.
- `start --pr-id` and watch mode can change Azure DevOps state; use them only
  with credentials and repositories where those side effects are intended.

For the full configuration schema, scanner settings, merge policy, and release
verification workflow, see the repository [README](../../README.md).
