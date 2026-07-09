## Why

The existing code-review-agent provides basic AI-powered PR reviews using an LLM and SonarQube integration, but lacks the governance, risk classification, automated remediation, merge blocking, dashboarding, and CVE/security scanner integrations required for it to serve as a genuine PR quality gate in a regulated environment. The PRD calls for evolving this into a **PR Guardian Copilot** — a centralized AI copilot that not only reviews code but also enforces policy, creates tracking tasks, blocks risky merges, and provides transparent analytics across pilot repositories.

## What Changes

- **Risk classification system** — Every finding gets a category (Bug, Security, Compliance, CVE/dependency), severity (Critical/High/Medium/Low/Informational), confidence level, evidence, business impact, and remediation recommendation.
- **PR event detection** — Automatically trigger review on PR creation and every subsequent commit push. Replace the current poll-based scan with event-driven hooks where possible.
- **CVE and dependency scanning** — Integrate a software composition analysis tool or vulnerability database to detect vulnerable dependencies.
- **Secret scanning** — Integrate or enhance existing `maskSensitiveData` to also detect newly introduced secrets.
- **Compliance rule checking** — Support version-controlled policy-as-code rules evaluated against the PR diff and repository context.
- **Automated work item creation** — Create remediation Azure DevOps work items automatically for Critical and High findings.
- **Merge governance** — Report branch policy status that blocks PR completion while unresolved blocking findings exist against the latest commit.
- **Re-review on new commits** — Re-run analysis when the source branch is updated, superseding or closing previously resolved findings.
- **Exception and override workflow** — Authorized users can waive findings with business justification, expiry date, and full audit trail.
- **False-positive and feedback handling** — Each finding supports feedback (true positive, false positive, by design, risk accepted, already addressed) for continuous improvement.
- **Analytics dashboard** — Web dashboard showing PR cycle time, first-review response, findings by severity, remediation status, CVE trends, reviewer activity, and adoption metrics.
- **Audit trail** — Every analysis result records the source commit, rules/engine version, model version, review timestamp, and resolution status.
- **Review latency SLA** — Initial acknowledgement within 30 seconds, standard review within 3–5 minutes, with clear failure states.

### Breaking Changes

- The current finding schema will be replaced with a richer normalized finding structure (category, severity, confidence, evidence, business impact, blocking status, linked task, resolution status).
- Configuration format may change to support policy-as-code rules, severity thresholds, and merge policy configuration.
- **BREAKING**: The existing simple PR comment format will be replaced with structured findings that include severity badges, category tags, and remediation task links.

## Capabilities

### New Capabilities

- `risk-classification`: Normalized finding taxonomy with category, severity (Critical through Informational), confidence, evidence, business impact, and remediation recommendations.
- `pr-event-detection`: Automatic review triggering on PR creation and source branch updates — event-driven, with re-review and finding reconciliation.
- `cve-scanning`: Integration with SCA or vulnerability database for dependency vulnerability detection.
- `secret-scanning`: Detection of secrets, tokens, and credentials in new PR changes.
- `compliance-checking`: Policy-as-code rule evaluation against PR changes and repository context.
- `remediation-tasks`: Automatic Azure DevOps work item creation for Critical/High findings, with linkage to PR and finding.
- `merge-governance`: Branch policy status that blocks PR completion while unresolved blocking findings exist.
- `re-review`: Re-running analysis on new commits with superseding/closing of prior findings.
- `exception-workflow`: Authorized override with justification, expiry, and full audit trail.
- `false-positive-feedback`: Per-finding feedback mechanism for continuous improvement.
- `analytics-dashboard`: Web dashboard with risk, delivery, and adoption metrics.
- `audit-trail`: Immutable record of each analysis result with commit, engine, model, and timestamp.

### Modified Capabilities

- *(No existing specs to modify — this is the initial spec definition for the project.)*

## Impact

- **Core agent architecture**: The single `codeReviewAgent` is currently the main review engine. The new design requires a pipeline that combines deterministic scanners (CVE, secrets, SAST) with AI analysis, then correlates and prioritizes findings — not just one LLM call.
- **Data model**: The existing Zod schemas for findings need significant expansion to include severity, category, blocking status, linked tasks, and resolution state.
- **Configuration**: Config system needs to support policy-as-code rules, severity definitions, merge policy thresholds, and scanner enablement flags.
- **New dependencies**: SCA tool integration, work item API usage (already available via ADO API client), dashboard frontend framework, and potentially a lightweight database for the dashboard.
- **ADO integration**: Extended use of branch policy APIs, work item creation APIs, and webhook/event subscriptions.
- **CLI**: The current `scan`, `studio`, `init` commands remain, but `scan` gains new flags for policy enforcement and dashboard reporting. A new `dashboard` command or mode may be needed.
- **plain TypeScript workflows**: The `pr-review-workflow` needs to be restructured to support the multi-stage pipeline (scanners → AI analysis → dedup/prioritize → comment → task creation → policy evaluation).
