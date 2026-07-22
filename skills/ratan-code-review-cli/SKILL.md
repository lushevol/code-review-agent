---
name: ratan-code-review-cli
description: "Guide for using the ratan-code-review CLI — AI-powered code review agent for Azure DevOps (ADO). Triggers on: 'ratan-code-review', 'code review cli', 'run code review', 'review PR', 'setup/configure/start ratan', 'scan PR', 'ratan dashboard', 'PR Guardian', 'code review agent', 'review azure devops pr', 'code review pipeline', 'code review tool'. Actions: install, configure, setup, scaffold, run, start, review, scan, check, monitor, watch, dashboard, troubleshoot, debug, fix config. Objects: PR, pull request, ADO, Azure DevOps, config, .ratan, finding, findingStore, audit, compliance, SonarQube, OCR, OpenCodeReview, feedback daemon, auto-scan, merge gate."
---

# Ratan Code Review CLI

IRON LAW: VERIFY before you EXECUTE. Never run or suggest a `ratan-code-review` command without first establishing the user's environment state. Check: is the package installed/built? Does `.ratan/` exist? Is the config populated with real values (not placeholders)? Are required env vars set? If the command will produce side effects (ADO comments, status checks, work items), warn the user and get confirmation.

Red Flags (return to Step 1 if any appear):
- "Let me just run `ratan-code-review start --pr-id N` to check" (skipping verification)
- "I think the config probably works" (guessing, not verifying)
- Running commands without checking if `.ratan/config.json` has placeholders
- Assuming `ADO_TOKEN` is set without checking

## Workflow

Copy this checklist and check off items as you complete them:

```
Ratan Code Review CLI Progress:

- [ ] Step 1: Understand the user's goal ⚠️ REQUIRED
- [ ] Step 2: Check environment state ⛔ BLOCKING
  - [ ] 2.1 Is the package installed and built?
  - [ ] 2.2 Does .ratan/ exist with config?
  - [ ] 2.3 Are env vars (ADO_TOKEN, OCR_LLM_TOKEN) set?
  - [ ] 2.4 Is the config populated (no placeholders)?
- [ ] Step 3: Determine command and flags
  - [ ] 3.1 Select command (start, dashboard)
  - [ ] 3.2 Select mode (single PR, watch, one-shot scan)
  - [ ] 3.3 Identify required/additional flags
- [ ] Step 4: Confirm with user ⚠️ REQUIRED
- [ ] Step 5: Execute and verify
- [ ] Step 6: Interpret results for user
```

## Step 1: Understand the User's Goal ⚠️ REQUIRED

Ask: What is the user trying to accomplish? Map to one of these categories:

| If the user says... | They want... | Lead command |
|---------------------|-------------|--------------|
| "Set up code review" / "Configure ratan" / "First-time setup" | Install, scaffold, initial config | `ratan-code-review start` (first run) |
| "Review PR #123" / "Check this PR" / "Scan this PR" | Single PR review with result | `start --pr-id 123` |
| "Watch my repos" / "Auto-review PRs" / "Monitor" | Continuous scanning | `start --watch` |
| "Show the dashboard" / "View findings" / "Open the UI" | Dashboard UI + API | `dashboard` |
| "It's broken" / "ADO connection failed" / "X isn't working" | Troubleshooting | Check env + config |

If the goal is unclear, ask a clarifying question. Do NOT guess.

## Step 2: Check Environment State ⛔ BLOCKING

**Do not proceed past this step until all checks that apply to the user's goal are done.**

### 2.1 Package installation

```bash
# Check if installed globally
which ratan-code-review 2>/dev/null && ratan-code-review --version

# Check if built locally (in monorepo)
ls agents/ratan-code-review-agent/dist/cli.js 2>/dev/null
```

If not found:
- Global install: `npm install -g ratan-code-review`
- Local (monorepo dev): need to run `pnpm build` first

Ask: Is this a published npm installation (global) or local repo development? Adjust commands accordingly — local dev uses `pnpm start`, installed uses `ratan-code-review <command>`.

### 2.2 Config scaffolding

```bash
ls .ratan/config.json 2>/dev/null
```

If `.ratan/` doesn't exist, the `start` command scaffolds it automatically on first run.

### 2.3 Environment variables

Ask: Which of these env vars are relevant?

| Variable | Required for | Config field |
|----------|-------------|--------------|
| `ADO_TOKEN` | All operations (ADO connection) | `config.ado.token` |
| `OCR_LLM_TOKEN` | OpenCodeReview scanner | `config.openCodeReview.llm.token` |
| `SONARQUBE_TOKEN` | CVE scanner, SonarQube measures | `config.sonarQube.token` |
| `OCR_LLM_URL` | Custom LLM endpoint URL | `config.openCodeReview.llm.url` |

```bash
# Check if set
echo "${ADO_TOKEN:+set}" "${OCR_LLM_TOKEN:+set}" "${SONARQUBE_TOKEN:+set}"
```

### 2.4 Config validation

```bash
cat .ratan/config.json 2>/dev/null | head -20
```

Check for placeholder values: `your-organization`, `your-project`, `set-your-llm-token`, `set-your-sonar-token`, `http://your-llm-endpoint`, `https://your-sonarqube`.

The `start` command runs an interactive config wizard on first run if placeholders are detected and the terminal is TTY.

If in a monorepo, verify build is up to date:

```bash
cd agents/ratan-code-review-agent && ls dist/cli.js 2>/dev/null
```

## Step 3: Determine Command and Flags

### Command: `start`

| Flag | Purpose | Example |
|------|---------|---------|
| `--pr-id <number>` | Review a single PR, wait for result | `--pr-id 42` |
| `--watch` | Continuous mode: scan every 30 min + feedback daemon | `--watch` |
| `--config <path>` | Custom config directory (default: `.ratan`) | `--config /path/to/config` |
| `--repo-pattern <patterns...>` | Repo glob patterns to scan | `--repo-pattern 'my-team-*'` |

Modes of operation:

- **No flags**: Scaffold `.ratan/` if needed, scan all eligible repos once, wait for queue to drain, exit.
- **`--pr-id`**: Bypass auto-scan queue. Review one PR directly. Completion and failures propagate to the caller. Best for CI/CD or explicit manual review.
- **`--watch`**: Continuous loop. Auto-scans every 30 min (configurable via `config.watch.intervalMs`). Starts feedback daemon (ADO comment sync, false-positive detection) automatically.

### Command: `dashboard`

| Flag | Purpose | Default |
|------|---------|---------|
| `--port <number>` | Dashboard server port | `3099` |
| `--finding-store <path>` | Path to findings SQLite DB | `.ratan/data/findings.db` |
| `--config <path>` | Config directory | `.ratan` |

Exposes these API endpoints:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Health check |
| `GET /api/prs` | Reviewed PR listing |
| `GET /api/findings` | All findings (filterable) |
| `GET /api/overrides` | Override management |
| `GET /api/audit` | Audit records |
| `GET /api/stats` | Aggregate stats |
| `GET /api/queue` | PR queue status |

### Command: `webhook` (programmatic API)

For ADO webhook integration (auto-registration of `git.pullrequest.created` / `git.pullrequest.updated` subscriptions + HMAC-SHA256 validation). Requires `WEBHOOK_PUBLIC_URL` env var.

### Package scripts (local development)

| Script | Equivalent command |
|--------|-------------------|
| `pnpm dev` | `tsx src/cli/index.ts start --watch` |
| `pnpm start` | `node ./bin/ratan-code-review.cjs start` |
| `pnpm evaluate:golden` | Evaluate synthetic golden PR corpus |

## Step 4: Confirm with User ⚠️ REQUIRED

Present the planned command and context. Ask:

- "The command `ratan-code-review start --pr-id 42` will review PR #42 and post comments + status to ADO. Proceed?"
- "This is a one-time scan (not continuous). Confirm?"
- "The dashboard will start on port 3099. OK?"
- "This will create a `.ratan/` folder and scaffold default config. Proceed?"

⚠️ Do NOT execute commands with side effects (ADO comments, status checks, work item creation) without explicit user confirmation. The `start --pr-id` and `start` commands produce ADO side effects.

## Step 5: Execute and Verify

Run the command. Use the appropriate invocation:

**Published package (global npm install):**
```bash
ratan-code-review <command> [flags]
```

**Local monorepo (development):**
```bash
# Via pnpm script
pnpm --filter ratan-code-review start --pr-id 42

# Or direct node invocation
node agents/ratan-code-review-agent/bin/ratan-code-review.cjs start --pr-id 42

# Or tsx for hot reload
pnpm dev
```

After execution, verify:
- Did it exit with code 0?
- Were any warnings printed (config placeholders, missing SonarQube)?
- Did the expected output appear (PR review decision, scan count, dashboard URL)?

## Step 6: Interpret Results

### Start command output

- **First run**: Scaffolds `.ratan/` with `config.json`, `opencodereview/rule.json`, `logs/`, `data/`. Interactive config wizard if TTY.
- **Config validation**: Logs warnings for placeholder values, missing SonarQube config, incomplete LLM config.
- **Single PR (`--pr-id`)**: Direct result — blocked/approved with inline comments on ADO.
- **Auto-scan**: Prints number of PRs enqueued. Each PR checked for build pipeline before processing.
- **Watch mode**: Prints scan interval, feedback daemon status. Runs until Ctrl+C.

### Dashboard output

- Prints `Dashboard listening on http://localhost:<port>`
- API health: `GET http://localhost:<port>/api/health`

### Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `Could not connect to Azure DevOps` | ADO_TOKEN missing or wrong org/project | Check `config.ado` and `$ADO_TOKEN` |
| `LLM endpoint not healthy` | OCR LLM URL/token wrong or endpoint down | Check `config.openCodeReview.llm` |
| `Option '--pr-id' requires a value` | Missing number after flag | Use `--pr-id 123` not `--pr-id` alone |
| `Cannot find module` | Package not built or installed | Run `pnpm build` or `npm install -g` |
| `Legacy prompts are no longer supported` | Old `.ratan/prompts/` directory | Remove `prompts/`, review `config.openCodeReview` |
| `Skipping PR — no build pipeline` | PR's repo has no ADO build pipeline | Expected for repos without CI configured |

## Anti-Patterns

- Don't run commands without first checking if `.ratan/config.json` exists and is populated. The first-run scaffold creates it with placeholders — running immediately will fail ADO connection.
- Don't suggest `--pr-id` without a number argument. The parser treats missing values as an error.
- Don't run `start` without `--watch` in CI and expect it to keep running — it exits after the queue drains.
- Don't assume the package is globally installed. In a monorepo, it's a local workspace package.
- Don't ignore config validation warnings. Missing LLM config means OpenCodeReview scanner produces no findings.
- Don't suggest `pnpm dev` without warning the user it creates ADO side effects.
- Don't run `evaluate:golden` without `--dry-run` or explicit `--case` — it sends synthetic PR data to the configured LLM endpoint and costs money.

## Pre-Delivery Checklist

- [ ] User's goal is clearly mapped to one of: setup, single-PR review, monitoring, dashboard, or troubleshooting
- [ ] Environment state verified: installed/built, config populated, env vars set
- [ ] Command confirmed with user before execution (side-effect warning given if applicable)
- [ ] Selected command and flags match the user's goal (not random defaults)
- [ ] Command output interpreted and explained to user
- [ ] Any warnings or errors from the run are addressed
