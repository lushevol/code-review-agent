## Context

The existing code-review-agent is a framework-based AI code review system that scans Azure DevOps pull requests, reviews diffs using an LLM (`codeReviewAgent`), optionally integrates SonarQube, and posts PR comments. It operates on a polling loop (`scan` CLI command with optional `--watch`) and reads configuration from local filesystem or ADO repos.

The PRD calls for evolving this into a **PR Guardian Copilot** — a centralized, policy-enforcing, multi-scanner code review platform with merge governance, automated remediation, and analytics. This requires significant architectural changes to support a pipeline of deterministic scanners alongside AI analysis, a richer finding data model, work item integration, branch policy enforcement, and a web dashboard.

### Current Architecture (simplified)

```
startup → scanPRs(ADO) → prReviewWorkflow:
  fetch-pr-details → pr-review-issues-workflow (LLM review) → code-summary → sonarqube-measures → comment-review-results
```

### Target Architecture (simplified)

```
PR Event (webhook/poll) → Eligibility Gate → Collect Context
  ├── Fetch ADO Work Item Details from Commit Messages (NEW)
  → Parallel Scanners:
      ├── AI Code Review (existing LLM + work item context)
      ├── CVE / Dependency Scanner via SonarQube Issues API (NEW)
      ├── Compliance Rule Engine (NEW)
      └── SonarQube Measures (existing)
  → Finding Correlation & Dedup (by content context hash)
  → Risk Classification & Prioritization
  → Post Results:
      ├── PR Summary & Inline Comments
      ├── Work Item Creation (Critical/High)
      └── Branch Policy Status (Merge Gate)
  → Re-review on Commit → Supersede/Close findings (by content hash)
  → Feedback Daemon (background: collects ADO reactions, surfaces prompts)
```

### Stakeholders

- Development teams across pilot repositories
- Security and compliance teams
- Engineering managers (dashboard analytics)
- Platform/DevOps team (maintaining the agent)
- Audit and governance teams

## Goals / Non-Goals

**Goals:**

1. Establish a pluggable scanner pipeline architecture that supports multiple finding sources (AI, CVE, secrets, compliance, SAST)
2. Define a normalized finding data model covering category, severity, confidence, evidence, business impact, blocking status, and resolution
3. Enable automated work item creation for Critical and High findings via ADO WIT API
4. Implement branch policy integration that blocks PRs on unresolved blocking findings
5. Support re-review on new commits with finding lifecycle management (supersede, close, reopen)
6. Provide an exception/override workflow for false positives and accepted risks
7. Deliver an analytics dashboard for PR risk, delivery, and adoption metrics
8. Implement full audit trail for every review result

**Non-Goals:**

- Replacing SonarQube or other authoritative security scanners — scanners remain deterministic tools; the AI layer correlates and explains
- Building a custom CVE database — will integrate with existing SCA tools
- Realtime code review (synchronous) — reviews are asynchronous with SLA targets
- Replacing the Azure DevOps PR workflow — the agent complements existing processes
- Multi-provider support (GitHub, GitLab) — Phase 2 consideration only

## Decisions

### D1: Scanner Pipeline Architecture

Each scanner is an independent step in the plain TypeScript workflow, producing typed findings that feed into a correlation step. Scanners run in parallel where possible.

**Rationale:** New scanner types (CVE, secrets, compliance) can be added without modifying existing scanners. The correlation step is the single point of deduplication and prioritization, keeping each scanner simple. Parallel execution minimizes total review latency.

**Alternatives considered:**
- *Monolithic agent prompt:* Was considered but rejected — combining all scanner concerns in one LLM prompt degrades accuracy and makes it impossible to add deterministic scanner outputs.
- *Sequential pipeline:* Simpler but increases latency linearly with each scanner.

**Implementation:** Scanners are wrapped into the `Scanner` interface and run via `Promise.allSettled` inside a single `scanner-pipeline` plain TypeScript step, using plain TypeScript review runtime's existing `.parallel()` pattern for independent steps (codeSummary, SonarQube measures).

### D2: Normalized Finding Schema

Adopt a single normalized `Finding` schema (Zod) shared across all scanners and used for storage, display, and API contracts.

```typescript
interface Finding {
  id: string;                    // UUID
  prId: number;
  repository: string;
  filePath: string | null;       // null for PR-level findings
  lineStart: number | null;
  lineEnd: number | null;
  category: 'bug' | 'security' | 'compliance' | 'cve' | 'dependency' | 'quality';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'informational';
  confidence: number;            // 0.0 - 1.0
  title: string;
  description: string;
  evidence: string;              // supporting context or code excerpt
  businessImpact: string;
  remediation: string;
  blocking: boolean;
  linkedTaskId: number | null;   // ADO work item ID
  resolution: 'open' | 'resolved' | 'superseded' | 'waived' | 'false-positive' | 'accepted-risk';
  sourceEngine: string;          // e.g., 'ai-review', 'sonarqube-cve', 'compliance'
  sourceVersion: string;         // engine/rule version
  contentHash: string;           // SHA-256 of (filePath + surrounding code) — survives line shifts
  supersedesFindingId: string | null;
  createdAt: string;             // ISO timestamp
  resolvedAt: string | null;
}
```

**Rationale:** A single schema simplifies storage, querying, and UI rendering. The `sourceEngine` field preserves provenance without per-scanner schemas. The `contentHash` field enables content-addressable finding identity across re-reviews.

### D3: Finding Lifecycle States

```
open → resolved (remediated in new commit)
open → superseded (overtaken by updated finding in re-review)
open → waived (authorized exception)
open → false-positive (marked by reviewer)
waived → open (re-opened if exception expires)
```

Lifecycle transitions are tracked in an audit log. Only the latest review result per PR commit is considered for merge policy.

### D4: Work Item Integration

Use the existing `ratan-ado-api` package's WIT API client to create and link work items. Critical → Bug work item type, High → Task work item type. The work item ID is stored in the finding's `linkedTaskId`.

**Rationale:** Reuses existing ADO API infrastructure. No new ADO authentication surface.

**Alternatives considered:**
- *Generic webhook:* More flexible but loses traceability — ADO work items provide native tracking, assignment, and SLA features.

### D5: Merge Governance via Branch Policy Status

The agent reports a branch policy status (using ADO PR Status API) rather than modifying branch policies directly. This is the standard ADO pattern for external quality gates. The status is set to `failed` (blocks merge) or `succeeded` (allows) based on the latest review state.

**Rationale:** Branch policies are owned by repository administrators. Using PR Status API is the recommended ADO integration pattern for non-human reviewers. It also allows the policy to be bypassed by authorized users (a built-in ADO feature).

### D6: Dashboard Architecture

Separate backend service (lightweight, perhaps Express or a Express service) that queries the review results store and serves REST/GraphQL to a frontend (React). Data is written by the agent after each review completes.

**Rationale:** Decoupling the dashboard from the review agent prevents review latency from being affected by dashboard load. The agent writes once; the dashboard reads many times.

**Storage options:** SQLite for pilot simplicity (single-agent deployment), with migration path to PostgreSQL for production.

### D7: Exception and Override Workflow

Overrides are not stored in ADO work item custom fields. Instead, the agent maintains its own override registry (same store as findings) with a signed-off field, justification, approved-by, and expiry date. When evaluating merge policy, the agent checks for active overrides before setting the blocking status.

**Rationale:** ADO work item custom fields are project-scoped and cannot be enforced across repositories. A dedicated override registry gives us full control over the audit trail and expiry logic.

### D8: Re-review Strategy

On each new commit push, the full scanner pipeline re-runs. Existing findings for the PR are compared against new findings:
- Findings that no longer appear → `resolved`
- Findings with same signature but different detail → `superseded` by new finding
- Completely new findings → `open`
- Findings with active overrides → re-evaluated

Finding identity is determined by a SHA-256 `contentHash` of `(filePath + normalized surrounding code lines)`. This content-addressable approach survives line-number shifts across commits — when a developer adds a comment above the affected code, the content hash stays the same while the line number changes.

Fallback: `(filePath, lineStart ± 3, sourceEngine, category)` when content context is ambiguous or the surrounding code changed substantially.

### D9: Event Detection

Primary: ADO webhook (PR created, PR updated) for low latency. Fallback: polling with configurable interval (30s minimum) for repositories where webhooks cannot be configured.

Webhook receiver is a lightweight HTTP endpoint that enqueues a review job. The plain TypeScript workflow is triggered asynchronously.

Webhooks are auto-registered at startup when running `scan --mode=service`. The agent calls `adoClient.createSubscription()` for `git.pullrequest.created` and `git.pullrequest.updated` events. If auto-registration fails (permissions, network), the agent falls back to polling with a 30-second configurable interval.

### D11: Content-Addressable Finding Identity

Finding identity uses a SHA-256 `contentHash` built from the file path and surrounding code context (3-5 lines of diff). This design intentionally trades storage for robustness against line number shifts across commits.

**Rationale:** Prior approach using `(filePath, lineStart, category, title)` broke on every commit where lines were added above the finding location, creating duplicates on every re-review.

### D12: PR Context from Commit Messages

A new pre-scan step (`fetch-workitem-context`) is inserted between fetching PR details and running scanners. It extracts ADO work item IDs from commit messages in the PR (both linked and unlinked), fetches the work item's description, acceptance criteria, and comments via the existing ADO WIT API, and injects this context into the AI review agent's prompt.

**Rationale:** The LLM produces better reviews when it understands *what* the PR is supposed to do, not just the diff it sees. Acceptance criteria give it ground truth to evaluate against.

### D13: Feedback Daemon

A separate background process (running via `scan --feedback-daemon` or as part of `scan --mode=service`) that periodically:
1. Polls FindingStore for findings with ADO comment threads
2. Reads human replies on those threads
3. Classifies feedback types (true-positive, false-positive, by-design, etc.)
4. Aggregates per-engine false-positive rates
5. Surfaces a report with examples and suggested prompt adjustments

**Semi-automated:** The daemon generates recommendations. A human reviews and approves changes to prompts and rules. The daemon does NOT auto-apply.

### D10: Service Mode Deployment

The agent runs as a persistent service via `scan --mode=service` rather than one-shot CLI invocations. The service embeds:
- Webhook receiver (Express HTTP server)
- SQLite FindingStore (findings, overrides, audit)
- Dashboard REST API (Express)
- plain TypeScript workflow engine
- Optional feedback daemon

**Rationale:** A persistent process is required for webhook-triggered reviews, background feedback collection, and dashboard data availability. SQLite is sufficient for pilot scale (single-agent deployment). The existing `scan` (one-shot) and `scan --watch` (polling) modes remain available.

### D11: Policy-as-Code Rules

Compliance rules are stored as YAML or HCL files in a `.ratan/code-review-agent/rules/` directory (local or ADO-managed). Each rule defines:

```yaml
rule-id: no-secrets-in-config
description: Secrets must not appear in config files
severity: high
category: compliance
patterns:
  - file_pattern: "*.config.*"
    forbidden: ["password", "secret", "api_key", "token"]
```

Rules are evaluated by the compliance scanner step, which checks changed files against the rule patterns.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| **Review latency increases** with parallel scanner pipeline and correlation step | Target: initial ack within 30s, full review within 3-5 min for standard PRs. Large PRs (>1000 lines) may enter async review mode with notification. |
| **False-positive rate** may cause developer frustration, leading to bypass behaviors | Collect FP feedback per finding. Track FP rate in dashboard. Provide clear override path with audit. |
| **CVE scanner integration** depends on SonarQube availability | CVE scanning uses existing SonarQube Issues API (`issues/search`) — no external CLI tools needed. SonarQube is already a project dependency. Falls back gracefully with empty findings if unavailable. |
| **Dashboard adoption** depends on data quality and UI polish | Start with a minimal viable dashboard showing top-10 metrics. Iterate based on pilot feedback. |
| **Overrides could be misused** to bypass legitimate findings | Require two-person approval for overrides on Critical findings. Log all overrides. Report override rate in dashboard. |
| **ADO API rate limits** may be hit with work item creation and status updates | Batch API calls where possible. Implement exponential backoff. Track API usage in metrics. |
| **Pipeline complexity** increases maintenance burden | Each scanner is a well-defined interface with isolated tests. Correlation logic is the most complex piece — invest in thorough testing there. |
| **Webhook delivery is not guaranteed** | Polling fallback with configurable interval. Duplicate detection via PR commit hash. |

## Open Questions

1. **Dashboard Framework:** React with a charting library (Recharts, Nivo) or a lighter approach (Observable Plot, or Grafana connecting to a read-only DB)? Lean towards React + Recharts for familiarity. Dashboard backend API is built; frontend SPA scaffold remains.
3. **Review SLA for Large PRs:** Should large PRs be split into chunks? Should the reviewer only sample changed files? Or should it provide a "degraded review" warning?
4. **Finding Dedup Strategy:** How aggressive should dedup be? Same-text findings in different files? Finding correlation level (AI findings that match scanner findings)?
5. **Pilot Scale:** Which 2-3 repositories? At least one React/TypeScript and one Java/Spring repo as specified in the PRD.
6. **Audit Retention:** How long should audit records be retained? Minimum 1 year for compliance; configurable.
