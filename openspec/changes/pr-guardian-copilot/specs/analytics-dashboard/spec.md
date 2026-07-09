## ADDED Requirements

### Requirement: Dashboard availability
The system SHALL provide a web-based analytics dashboard displaying PR risk, delivery, and adoption metrics.

#### Scenario: Dashboard loads
- **WHEN** an authorized user navigates to the dashboard URL
- **THEN** the dashboard SHALL render with metrics for the selected repository and time period

#### Scenario: Repository filter
- **WHEN** multiple pilot repositories are configured
- **THEN** the dashboard SHALL support filtering by repository

#### Scenario: Time period filter
- **WHEN** viewing dashboard metrics
- **THEN** the user SHALL be able to select a time period (7 days, 30 days, 90 days, custom range)

### Requirement: Risk and quality metrics
The dashboard SHALL display the following risk and quality metrics.

#### Scenario: Findings by severity
- **WHEN** viewing findings breakdown
- **THEN** the dashboard SHALL show a chart of findings by severity (Critical, High, Medium, Low, Informational) for the selected period

#### Scenario: Findings by category
- **WHEN** viewing findings breakdown
- **THEN** the dashboard SHALL show findings by category (Bug, Security, Compliance, CVE, Secret, Quality)

#### Scenario: Critical and High trend
- **WHEN** viewing the trends section
- **THEN** the dashboard SHALL show Critical and High findings over time (line chart)

#### Scenario: Remediation status
- **WHEN** viewing remediation metrics
- **THEN** the dashboard SHALL show open vs resolved/waived/false-positive findings with counts

#### Scenario: CVE trends
- **WHEN** viewing CVE metrics
- **THEN** the dashboard SHALL show CVE trends by severity over time

#### Scenario: Mean time to remediate
- **WHEN** viewing remediation metrics
- **THEN** the dashboard SHALL show the average time from finding creation to resolution

### Requirement: PR delivery metrics
The dashboard SHALL display PR delivery and productivity metrics.

#### Scenario: PR cycle time
- **WHEN** viewing delivery metrics
- **THEN** the dashboard SHALL show PR open-to-close cycle time (average, P50, P95)

#### Scenario: First review response time
- **WHEN** viewing delivery metrics
- **THEN** the dashboard SHALL show time from PR creation to first automated review comment

#### Scenario: PR throughput
- **WHEN** viewing delivery metrics
- **THEN** the dashboard SHALL show PRs merged per week for the selected period

#### Scenario: Review coverage
- **WHEN** viewing adoption metrics
- **THEN** the dashboard SHALL show percentage of PRs that received an automated review

### Requirement: Adoption metrics
The dashboard SHALL display adoption and activity metrics.

#### Scenario: Active contributors
- **WHEN** viewing adoption metrics
- **THEN** the dashboard SHALL show unique contributors who submitted PRs in the selected period

#### Scenario: Top PR commenters
- **WHEN** viewing adoption metrics
- **THEN** the dashboard SHALL show top reviewers by comment count (team-level, not individual ranking)

#### Scenario: Pilot onboarding status
- **WHEN** viewing the dashboard
- **THEN** the dashboard SHALL list pilot repositories and their onboarding status
