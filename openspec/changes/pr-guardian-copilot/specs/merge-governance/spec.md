## ADDED Requirements

### Requirement: Merge blocking via PR status
The system SHALL report a branch policy status on the ADO PR that blocks merging when unresolved blocking findings exist for the latest commit.

#### Scenario: Blocking findings present
- **WHEN** the latest review has one or more findings with `blocking = true` and `resolution = 'open'`
- **THEN** the system SHALL set the ADO PR status to `failed` with description "Blocking findings require resolution"

#### Scenario: No blocking findings
- **WHEN** the latest review has no unresolved blocking findings
- **THEN** the system SHALL set the ADO PR status to `succeeded` with description "No blocking findings"

#### Scenario: Review in progress
- **WHEN** a review is currently running for the latest commit
- **THEN** the system SHALL set the ADO PR status to `pending` with description "Review in progress"

### Requirement: Blocking criteria
A finding SHALL be considered blocking when its `blocking` field is `true` and its `resolution` is `open`.

#### Scenario: Override affects blocking
- **WHEN** a finding has an active override (waived, false-positive, or accepted-risk)
- **THEN** the finding SHALL NOT be considered blocking regardless of its severity

#### Scenario: Superseded finding not blocking
- **WHEN** a finding has `resolution` set to `superseded`
- **THEN** the finding SHALL NOT be considered blocking

### Requirement: Default blocking by severity
The system SHALL follow a default blocking policy based on severity.

#### Scenario: Critical blocking by default
- **WHEN** a finding has severity `critical`
- **THEN** `blocking` SHALL default to `true`

#### Scenario: High blocking by default
- **WHEN** a finding has severity `high`
- **THEN** `blocking` SHALL default to `true`

#### Scenario: Medium warning
- **WHEN** a finding has severity `medium`
- **THEN** `blocking` SHALL default to `false`

### Requirement: Status on latest commit only
The merge policy status SHALL reflect only the review result for the latest PR commit.

#### Scenario: Stale review ignored
- **WHEN** a new commit is pushed and the review has not completed for that commit
- **THEN** the system SHALL NOT consider previous commit's review results for merge policy

#### Scenario: Status update on review completion
- **WHEN** a review completes for the latest commit
- **THEN** the system SHALL update the PR status within 30 seconds
