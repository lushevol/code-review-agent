# RATAN Code Review Agent V2

## Leadership Presentation with Integrated Speaker Notes

**Session:** 20-minute presentation + 10-minute Q&A
**Narrative:** V1 proved the value of AI-assisted code review. V2 makes the capability lighter, configurable, safer, and easier to adopt.

> Each slide contains concise presentation content followed by detailed speaker notes.

---

## Slide 1 — RATAN Code Review Agent

### Presentation content

**From V1 proof of value to a reusable V2 product**

- Reduce manual review effort
- Apply review principles consistently
- Detect release risks earlier
- Improve release confidence

---

### Speaker notes

Today I will present the RATAN Code Review Agent and the evolution from V1 to V2.

The overall objective has remained consistent: reduce repetitive human review effort, apply review principles more consistently, and detect risks before they become release blockers.

V1 proved that this approach creates value. Reviewers could see issues and unit-test coverage gaps before approving a pull request, rather than discovering them later during release validation.

However, V1 also exposed important product and engineering limitations. We had to build and maintain much of the review framework ourselves. The service was heavy to deploy, relied on PostgreSQL, and was difficult to customise for different languages and repositories.

V2 is our response to those lessons. It keeps the successful outcome but changes the product shape. The new direction is a lightweight CLI, based on an open code review engine, with local SQLite persistence, configurable review rules, better context injection, feedback collection, and proper support for incremental pull request commits.

The main message is: **V1 proved the capability; V2 makes it easier to adopt and continuously improve.**

---

---

## Slide 2 — What Is RATAN Code Review Agent?

### Presentation content

RATAN Code Review Agent is an AI-assisted pull request review tool for Azure DevOps repositories. It discovers eligible PRs, analyses code changes using configurable rules and project context, identifies defects, coverage gaps and security risks, then publishes actionable findings to help reviewers approve changes faster and more consistently and reliably.

---

### Speaker notes

RATAN Code Review Agent is an additional engineering control in the pull request lifecycle.

It should not be positioned as a replacement for human reviewers. The human reviewer remains responsible for final approval, business judgement, architectural trade-offs, and risk acceptance.

The agent provides a consistent automated first review. It retrieves the pull request and its changed code, applies configured review rules, uses the available project and business context, and publishes structured findings.

The findings can cover areas such as functional defects, error handling, test gaps, architecture concerns, dependency risks, CVEs, and local compliance rules.

The value is not simply that a large language model can analyse source code. The real value comes from combining the model with a controlled workflow:

- Selecting the right pull requests
- Preparing a safe workspace
- Providing relevant context
- Applying approved rules
- Combining AI and static scanner results
- Persisting findings
- Avoiding duplicated comments
- Capturing feedback
- Producing an auditable decision

For leaders, this translates into three outcomes: less manual work, more consistent review, and earlier detection of release risks.

---

---

## Slide 3 — The Problems Before V1

### Presentation content

### 1. High human effort

Reviewers repeatedly checked code quality, tests, error handling, dependencies, and common defects.

### 2. Inconsistent review rules

Review depth and focus varied by reviewer, repository, and technology.

### 3. Critical metrics appeared too late

CVE findings and unit-test coverage defects could block release and cause additional fixes, validation, and regression effort.

### Our response

Last year, we created **RATAN Code Review Agent V1**:

```text
Daemon service
  -> query eligible PRs from application repositories
  -> review changes one by one
  -> generate a comprehensive report
```

---

### Speaker notes

Before V1, we had three main problems.

### High human effort

Code review requires significant engineering time. Some parts of that review need experienced judgement, but many checks are repetitive.

Reviewers repeatedly look for missing tests, weak error handling, incorrect dependency usage, common coding defects, and violations of known engineering standards.

These checks are necessary, but asking senior engineers to repeat them manually on every pull request is not an efficient use of their time.

### Inconsistent review rules

The second issue was inconsistency.

Different reviewers naturally focus on different areas. One reviewer may focus on architecture, another on unit tests, and another on functional correctness.

The same code could receive different review depth depending on who was available, how much time they had, and how familiar they were with that repository.

This is not a criticism of reviewers. It is a scalability problem. Human review is valuable, but human attention is variable.

### Critical metrics appeared too late

The third issue was late risk discovery.

Some findings, such as CVEs or unit-test coverage defects, may block a release. If these are only identified during release preparation, the team has to stop, correct the issue, rerun pipelines, repeat validation, and perform additional regression testing.

The later a blocking issue is discovered, the more expensive it becomes.

### Why we created V1

To address these problems, we created RATAN Code Review Agent V1 last year.

V1 was designed as a daemon service. It queried available pull requests from configured application repositories, processed those pull requests one by one, analysed the changes, and produced a comprehensive report.

The intended operating model was continuous automated review. Developers did not need to manually request a review for every pull request. The daemon discovered eligible work and applied the same review principles repeatedly.

This was the first important step: moving common review checks closer to the point where code was submitted.

---

---

## Slide 4 — V1 Benefits

### Presentation content

- Issues were visible before PR approval.
- Unit-test coverage defects were identified earlier.
- Reviewers spent less time on repetitive checks.
- Review principles were applied more consistently.
- Teams had more time to resolve issues before release validation.

**V1 proved that AI-assisted review can improve review efficiency and release confidence.**

---

### Speaker notes

V1 produced clear and practical benefits.

The biggest improvement was timing. Review findings became visible while the pull request was still active and before the reviewer approved it.

This gave developers time to resolve problems as part of the normal pull request cycle.

Unit-test coverage defects were also identified earlier. Instead of discovering inadequate coverage at a later release gate, the team could respond while the code and its intent were still fresh.

V1 also reduced the reviewer's repetitive workload. The agent could perform an initial pass and present a structured report. The reviewer could then focus on higher-value decisions rather than manually checking every standard item.

Another benefit was consistency. The same core review principles were applied to each eligible pull request. This did not remove human variation completely, but it established a reliable baseline.

The most important leadership outcome was improved release confidence.

The value was not measured by how many comments the agent created. The value was that known issues and quality defects were visible earlier, which reduced late remediation and regression effort.

V1 therefore validated the business and engineering hypothesis: AI-assisted review can improve both efficiency and consistency when it is placed inside a controlled pull request workflow.

---

---

## Slide 5 — V1 Limitations

### Presentation content

1. Hard to customise rules by language, repository, and file type.
2. No effective feedback mechanism for continuous optimisation.
3. Heavy service deployment with PostgreSQL dependency.
4. Large changes could exceed the LLM context window.
5. Difficult to inject project and code context.
6. Difficult to reconcile findings across incremental PR commits.

**V1 proved the value, but the product model was difficult to scale and reuse.**

---

### Speaker notes

Although V1 proved the value, it also showed that building a robust AI review product requires significant supporting engineering.

### Hard to customise rules

Different languages and file types require different review behaviour.

Java code, TypeScript code, YAML configuration, SQL scripts, build files, generated files, and documentation should not all be processed in the same way.

Different repositories also have different architecture patterns and engineering principles.

In V1, defining and maintaining these differences was difficult. We had to implement repository filters, file filters, extension rules, language-specific instructions, and project-specific review logic ourselves.

### No effective feedback mechanism

A review tool must learn from user interaction.

Reviewers may agree with a finding, reject it, mark it as false positive, explain that it lacks context, or accept the risk by design.

V1 did not provide a strong mechanism to continuously capture those signals and use them to evaluate and improve the rules.

Without feedback, optimisation becomes based on assumptions rather than evidence.

### Heavy service deployment

V1 operated as a service and relied on PostgreSQL.

This created requirements around deployment, database provisioning, connectivity, schema management, monitoring, support ownership, and upgrade coordination.

That model may be acceptable for one centrally owned implementation, but it creates friction when other teams want to adopt the capability.

### LLM context-window limits

Large pull requests may contain more changed code and background information than the model can process in one request.

V1 therefore required custom context management. We had to choose which files to include, which files to exclude, how much related code to load, and how to keep the input inside the model limit.

This logic became complex and difficult to generalise.

### Hard to inject deeper context

A pull request diff can reveal local issues, but deeper risks often require more information.

For example, the agent may need to know:

- Which module owns a responsibility
- Which shared abstraction should be reused
- Which business flow is critical
- Which dependency is approved
- Which architectural boundary must not be crossed
- Which operational behaviour is expected

V1 did not make this context easy to package and inject.

### Incremental commit limitations

Pull requests change over time. A developer may push a new commit that fixes one issue, leaves another unchanged, and introduces a third.

A mature review tool must reconcile findings across those commits.

V1 did not provide the level of commit-aware finding lifecycle that we need. This could create outdated findings or repeated comments.

These limitations led directly to the V2 design.

---

---

## Slide 6 — V2 Architecture

### Presentation content

```text
CLI command / Agent Skill
        |
        v
Azure DevOps PR + work-item context
        |
        v
Safe temporary review workspace
        |
        v
Open code review engine
 + optional CVE scanner
 + optional compliance scanner
        |
        v
Finding consolidation and prioritisation
        |
        v
Local SQLite database + dashboard
        |
        v
ADO status, comments, report and feedback
```

### Design principles

- CLI-first and local-first
- Open review engine with enterprise controls
- Deterministic workflow around AI
- Safe failure and auditable decisions
- Human reviewer remains accountable

---

### Speaker notes

V2 changes both the implementation and the operating model.

### CLI-first

The entry point is a CLI command or an Agent Skill that invokes the CLI.

A team can install the package on an approved virtual machine, provide its configuration, and run the tool without deploying a dedicated central service.

The CLI can review one specified pull request, perform one discovery scan, or operate in a recurring watch mode.

### Azure DevOps and business context

The tool retrieves pull request metadata, commits, changed files, and linked work-item information.

The linked work-item context is important because code alone may not explain the intended behaviour. Acceptance criteria, descriptions, and comments can help the reviewer understand what the change is supposed to achieve.

### Safe temporary workspace

V2 creates a disposable review workspace representing the base and head commits.

This allows the review engine to inspect the change without modifying the developer's local checkout.

Sensitive values in changed text can be masked before the content is submitted to the approved AI endpoint.

### Open code review engine

The open code review engine acts as the primary AI reviewer.

Using an existing engine reduces the amount of low-level review framework that RATAN must build and maintain.

However, RATAN still controls the enterprise boundary:

- Which engine version is approved
- Which model endpoint is used
- Which repositories are eligible
- Which rules are applied
- Which scanners are enabled
- Which findings are blocking
- How output is published
- How decisions are audited

### Optional scanners

The primary AI reviewer can run alongside optional scanners.

A CVE scanner can contribute vulnerability and security-hotspot findings. A local compliance scanner can detect rules such as prohibited logging, TODO markers, large files, or team-defined YAML patterns.

The purpose is composition. AI review, static analysis, security scanning, and compliance checks solve different problems and should be combined.

### Consolidation and persistence

Results from the different reviewers are consolidated and prioritised.

Overlapping findings are deduplicated, findings receive stable identities, and the results are stored in SQLite.

SQLite provides durable state without a separate database server. It stores findings, reviewed commits, Azure DevOps thread links, overrides, feedback, decisions, and audit metadata.

### Publication

The tool publishes structured results back to Azure DevOps.

This can include inline comments, one PR-level conclusion, a merge status, and links between persisted findings and Azure DevOps threads.

The workflow remains deterministic. AI produces findings, but the application controls execution, persistence, failure behaviour, and publication.

---

---

## Slide 7 — V2 Features: Adoption and Customisation

### Presentation content

1. **Easy installation**
   CLI packaging with minimal infrastructure dependencies.

2. **Configuration-first**
   Repositories, files, scanners, thresholds, outputs, and execution modes are configurable.

3. **Custom review rules**
   Rules can be defined by language, repository, file type, and review focus.

4. **Easy context injection**
   Project standards, architecture principles, dependencies, business context, and linked work items can be included.

5. **Local persistence and dashboard**
   SQLite stores review history, findings, feedback, audit data, and thread links.

6. **Agent Skill integration**
   A repeatable skill can configure and drive the review workflow.

7. **Reusable product pattern**
   Other teams can reuse the CLI, workflow, scanners, storage, and feedback model while supplying their own rules and context.

---

### Speaker notes

### Easy installation

The CLI is designed to lower the entry barrier.

A team should be able to install an approved package, create or generate a configuration directory, provide credentials through approved environment references, and run a review.

This removes the need for every team to request a separate database and hosted service deployment.

### Configuration-first design

The product should externalise operational and review behaviour.

Examples include:

- Repository name patterns
- File include and exclude patterns
- Scanner enablement
- Review focuses
- Severity thresholds
- Comment limits
- Scan intervals
- Output and dashboard settings
- Model endpoint configuration

Configuration allows teams to adapt the tool without forking the core implementation.

### Custom rules and context

Review rules should be modular and project-aware.

A TypeScript frontend repository may focus on React rendering behaviour, state management, accessibility, API usage, and test coverage.

A Java service may focus on transaction handling, exception behaviour, database access, security, API compatibility, and observability.

The same mechanism should allow project context to be injected, including architecture documents, coding standards, repository summaries, dependency information, work items, and critical business-flow descriptions.

### SQLite and local dashboard

SQLite gives the CLI durable local state with minimal infrastructure.

The local dashboard can provide visibility into review history, finding status, feedback, scanner output, and audit information.

This is especially useful for pilots and team-level adoption because the user can inspect the behaviour without depending on a central reporting platform.

### Agent Skill

An Agent Skill can package the expected operating procedure.

The skill can help users initialise configuration, choose the correct review mode, run the CLI, interpret results, and follow the standard remediation workflow.

This makes the product easier to drive from an AI-assisted developer environment while keeping the actual review execution deterministic.

### Reusable pattern

The product is designed as a reusable pattern, not only a RATAN-specific script.

Other teams can reuse:

- CLI packaging
- Azure DevOps orchestration
- Temporary workspace preparation
- Open review engine integration
- Scanner composition
- SQLite finding lifecycle
- Dashboard
- Feedback collection
- Safe decision logic

Each adopting team can then provide its own repositories, rules, project context, and blocking criteria.

---

---

## Slide 8 — V2 Features: Trust and Continuous Improvement

### Presentation content

### Safe review decision

```text
Primary AI review incomplete
  -> PENDING: manual review required

Review complete + blocking findings
  -> BLOCKED: changes requested

Review complete + no blocking findings
  -> ALLOWED: no blocking issues
```

### Incremental commit support

- Every review is tied to a specific commit.
- Older running reviews become stale when a newer review starts.
- Existing findings are retained or updated.
- Fixed findings are marked resolved.
- New findings create new threads.
- Existing Azure DevOps comments are refreshed instead of duplicated.

### Continuous feedback

- Collect issue comments, resolutions, dismissals, and reactions.
- Identify valid findings and false positives.
- Measure rule effectiveness.
- Optimise rules and prompts continuously.

### Security and audit controls

- Run in an approved internal environment.
- Use an approved internal model endpoint.
- Mask sensitive changed text before AI processing.
- Use a disposable workspace without changing the developer checkout.
- Record reviewed commit, rules, model, findings, decisions, and feedback.
- Review and pin open-source dependencies through internal governance.

---

### Speaker notes

### Safe decision model

The merge decision is intentionally simple and conservative.

If the primary AI review is incomplete, the decision is pending. A human reviewer must decide.

If the review completes and open blocking findings remain, the decision is blocked.

Only when the primary review completes and no blocking findings remain can the result be allowed.

This prevents a technical failure from being interpreted as a clean review.

Optional scanner failures can be isolated so that one unavailable supporting tool does not crash the entire workflow. However, the primary AI review must complete before the tool can produce an allowed outcome.

### Incremental commit support

Every review is associated with a specific pull request commit.

If a newer review starts while an older review is still running, the older review is treated as stale and must not publish outdated results.

When a developer pushes a new commit, V2 reconciles the new results with the stored findings:

- Matching findings remain linked.
- Changed findings are updated or superseded.
- Findings that disappear after a fix are marked resolved.
- Newly introduced issues become new findings.
- Existing Azure DevOps threads are refreshed instead of duplicated.

This is essential for trust. Developers should see one evolving review conversation, not a new collection of repeated comments after every push.

### Feedback collection

V2 should continuously collect feedback from normal developer behaviour.

Signals can include:

- Comment replies
- Thread resolution
- Finding dismissal
- False-positive classification
- Reactions
- Accepted suggested fixes
- Findings that remain unresolved

These signals help measure which rules are useful and where the tool is producing noise.

Rule changes should be evaluated against historical examples before being promoted. This turns optimisation into a measurable engineering process.

### Security controls

The review should run inside an approved environment and use an approved model endpoint.

Changed text can be masked for sensitive values before AI processing.

The tool operates on a disposable workspace so it does not modify the developer's checkout.

Credentials should be referenced securely rather than stored directly in configuration files.

The open review engine and its dependencies must go through internal licensing, vulnerability, architecture, and version-approval processes.

### Audit controls

For every review, the system should be able to explain:

- Which repository and commit were reviewed
- Which rules and review focuses were selected
- Which engine and model configuration were used
- Which scanners completed or failed
- Which findings were produced
- Which findings were published or suppressed
- What merge decision was computed
- What reviewer feedback was later received

Auditability is essential because the agent contributes to an engineering control, even though the final approval remains human-owned.

---

---

## Slide 9 — Remaining Problems and Next Actions

### Presentation content

| Remaining problem | Proposed direction |
|---|---|
| Reliance on PAT | Move to an approved service credential or enterprise authentication model |
| Not integrated with AI Factory | Integrate model routing, logging, evaluation, prompt governance, access control, and audit |
| Deeper risks require project context | Define a standard project-context package for every onboarded repository |

### Standard project-context package

- Architecture principles
- Repository and module structure
- Coding and testing standards
- Dependency relationships
- Critical business flows
- Known operational and release risks
- Domain-specific review rules

---

### Speaker notes

V2 is a stronger product direction, but three important problems remain.

### PAT dependency

The current integration still relies on a personal access token.

PATs are convenient for development and pilots, but they are not the preferred long-term enterprise authentication model.

The next direction is to move toward an approved service identity or enterprise credential pattern. The objective is clear ownership, controlled permissions, rotation, auditability, and removal of dependency on an individual user.

The credential should use the minimum Azure DevOps permissions required to read pull requests and publish approved review output.

### AI Factory integration

V2 is not yet integrated with AI Factory.

For broad enterprise adoption, the tool should use standard platform capabilities where available:

- Approved model routing
- Authentication
- Usage logging
- Prompt and rule governance
- Model configuration management
- Evaluation
- Audit
- Access control
- Operational monitoring

The CLI should remain lightweight, while AI Factory provides the enterprise control plane.

### Project-context dependency

The quality of deep review depends on the quality of the context supplied.

Without project context, the agent can still detect local defects, but it may miss architectural, operational, or business risks.

The proposed solution is a standard context package for every onboarded repository.

That package should contain:

- Architecture principles
- Repository and module structure
- Coding and testing standards
- Approved and prohibited dependencies
- Critical business flows
- Operational expectations
- Known release risks
- Domain-specific review rules

Context readiness should become part of repository onboarding. A team should not expect deep project-aware review without providing the information required to understand the project.

---

---

## Slide 10 — How We Measure Success

### Presentation content

### Efficiency

- Reduction in manual review time
- Faster time to first review
- More PRs reviewed without increasing reviewer workload

### Quality

- Valid finding rate
- False-positive rate
- Blocking issues found before approval
- CVE and coverage defects found before release validation

### Trust and reliability

- Review completion rate
- Reduction in duplicate comments
- Findings resolved before approval
- Reviewer feedback participation

> The number of AI comments is not the success metric.
> Success means better engineering decisions, earlier risk detection, and less review effort.

---

### Speaker notes

The pilot should be judged by measurable outcomes, not by the volume of generated comments.

### Efficiency measures

We should measure the change in manual review time.

This can include time from pull request readiness to first review, time spent by senior reviewers, and total review turnaround time.

We should also observe whether more pull requests can receive a consistent first review without increasing reviewer workload.

### Quality measures

The most important model-quality measures are valid finding rate and false-positive rate.

A finding is valuable when the reviewer agrees that it identifies a real issue or a useful risk.

We should separately track high-severity and blocking findings, because these have greater release impact.

We should also measure how many CVE and unit-test coverage issues are identified before release validation.

### Trust and reliability measures

The review-completion rate shows whether the tool is operationally reliable.

The duplicate-comment rate shows whether incremental review reconciliation is working.

Feedback participation shows whether reviewers are actively engaging with the results rather than ignoring them.

We should also measure how many findings are resolved before pull request approval.

### Release-confidence measures

Over time, the strongest measure is whether fewer known review-related issues escape into later validation or production.

This requires a longer observation period, but it connects the tool directly to the intended business outcome.

The key message is: the agent should not be rewarded for producing more comments. It should be evaluated on precision, earlier detection, reduced effort, and improved engineering decisions.

---

---

## Slide 11 — Live Demo: One PR In, One Decision Out

### Presentation content

```bash
ratan-code-review start --pr-id 123
```

```text
1. Retrieve PR, commits and linked work-item context
2. Prepare a safe temporary workspace
3. Run AI review and optional scanners
4. Consolidate and store stable findings
5. Publish inline comments and PR summary
6. Set the merge status: pending, blocked or allowed
7. Capture reviewer feedback
8. Push an incremental commit and show finding reconciliation
```

### Demo focus

- One code-quality or functional finding
- One unit-test coverage issue
- One CVE or compliance signal
- One finding resolved after an incremental commit
- No duplicated review comments

---

### Speaker notes

The demo should be the final part of the presentation because it allows the audience to connect the earlier architecture and feature explanations to a real workflow.

For predictability, use a prepared test pull request and direct review mode:

```bash
ratan-code-review start --pr-id 123
```

### Step 1: Show the pull request

Start in Azure DevOps.

Explain the purpose of the pull request and show a small, controlled diff.

The pull request should contain several intentional examples:

- A code-quality or functional issue
- A missing or weak unit test
- A CVE, security, or local compliance signal
- One issue that will be fixed in a follow-up commit

Avoid using a very large or unpredictable pull request for the leadership demo.

### Step 2: Run the CLI

Show that the CLI loads configuration, connects to Azure DevOps, retrieves the pull request, and collects linked work-item context.

Explain that the direct PR mode bypasses broad repository discovery and gives a clear “one PR in, one decision out” demonstration.

### Step 3: Explain the safe workspace

Show or explain that the tool creates a temporary review workspace based on the pull request base and head commits.

The developer's working checkout is not modified.

Sensitive changed text can be masked before being sent to the approved AI endpoint.

### Step 4: Show the reviewers running

Explain that the open code review engine is the primary contextual reviewer.

Optional CVE and compliance scanners run alongside it.

The scanners are complementary. The AI reviewer reasons about the change, while the supporting scanners contribute known vulnerability, quality, or policy signals.

### Step 5: Show consolidated findings

Open the local dashboard or the generated report.

Highlight two or three findings only.

For each finding, explain:

- What was detected
- Which file and line are affected
- Why it matters
- Which review category or rule produced it
- Whether it is blocking
- What action is recommended

Do not spend the demo reading every comment.

### Step 6: Show Azure DevOps output

Return to the pull request and show:

- Inline comments
- One current PR-level summary
- The reviewed commit
- The merge-gate status

Explain the three possible statuses:

- Pending when the primary review is incomplete
- Blocked when blocking findings remain
- Allowed when the review completes with no blocking findings

### Step 7: Show feedback

Resolve or dismiss one finding, or add a reaction or comment.

Explain that V2 can synchronise these signals and use them to measure rule quality and identify false positives.

### Step 8: Show an incremental commit

Push or use a prepared second commit that fixes one of the issues.

Run the review again.

Show that:

- The fixed finding is marked resolved.
- An unchanged finding remains associated with its existing thread.
- New findings are added only when necessary.
- Comments are not duplicated.
- The new decision is tied to the latest commit.

### Final demo message

Close the demo with this statement:

> V1 demonstrated that automated review creates value. V2 turns that capability into a configurable and portable product, with safe decisions, stable findings, feedback-driven optimisation, and lower infrastructure dependency.

---

---

# Q&A Preparation

## Is V2 replacing human reviewers?

No. V2 provides an automated first review and structured evidence. Human reviewers remain responsible for final approval, architectural judgement, business context, and risk acceptance.

## Why build V2 if V1 already delivers value?

V1 validated the use case but is difficult to customise, operate, and reuse. V2 addresses the product limitations while preserving the successful review outcome.

## Why use a CLI instead of another central service?

A CLI reduces infrastructure dependency and allows teams to run the capability on approved virtual machines. It is easier to package, configure, pilot, and upgrade.

## Why use SQLite?

SQLite provides durable local state without a database server. It is sufficient for the initial CLI and team-level operating model. A shared central database can be reconsidered later if a multi-instance service becomes necessary.

## What does the open code review engine provide?

It provides the primary code-review workflow and reduces the amount of framework code that RATAN must build. RATAN still controls approved models, configuration, rules, security, scanners, output, and audit.

## How is this different from SonarQube?

SonarQube provides static analysis, quality measures, and security signals. The AI reviewer performs contextual analysis of the code change using project rules and context. The tools are complementary.

## What happens when a scanner fails?

An optional scanner can fail without stopping every other review stage. If the primary AI review is incomplete, the merge result is pending and requires manual review.

## How do we prevent low-quality comments?

Use focused rules, evidence-based findings, comment limits, stable finding reconciliation, reviewer feedback, quality metrics, and regression evaluation before rules are promoted.

## How do we protect internal code?

Run the tool in an approved internal environment, use an approved model endpoint, mask sensitive changed text, limit context to what is required, secure credentials, and retain audit records.

## What is the biggest remaining risk?

The biggest risk is loss of reviewer trust. If the tool produces noisy, repeated, or poorly explained findings, developers will ignore it. Precision and stable feedback handling are therefore more important than comment volume.
