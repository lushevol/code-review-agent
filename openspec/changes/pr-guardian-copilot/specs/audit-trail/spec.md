## ADDED Requirements

### Requirement: Audit record creation
Each completed review SHALL produce an audit record containing the full analysis result, including source commit, engine versions, model version, and timestamp.

#### Scenario: Review audit record
- **WHEN** a review completes for a PR commit
- **THEN** the system SHALL create an audit record containing: PR ID, repository, commit hash, review timestamp, all findings, source engines and versions, and model version

#### Scenario: No findings audit
- **WHEN** a review produces zero findings
- **THEN** the system SHALL still create an audit record indicating a clean review

### Requirement: Audit record content
Each audit record SHALL include sufficient information to reproduce or verify the review result.

#### Scenario: Complete audit record
- **WHEN** retrieving an audit record
- **THEN** it SHALL contain: review ID (UUID), PR ID, repository ID, source commit hash, base commit hash, review start and end timestamps, list of scanner engines and their versions, AI model identifier and prompt version, all findings with full detail, merge policy decision, and raw scanner outputs (where available)

### Requirement: Audit immutability
Audit records SHALL be append-only. Once created, records SHALL NOT be modified or deleted.

#### Scenario: Append-only constraint
- **WHEN** attempting to modify an existing audit record
- **THEN** the system SHALL reject the modification

#### Scenario: New review supersedes
- **WHEN** a re-review creates new audit record for the same PR
- **THEN** the previous audit record SHALL remain unchanged; the new record references the previous via a `supersedesReviewId` field

### Requirement: Audit querying
The system SHALL support querying audit records by PR, repository, time range, and finding severity.

#### Scenario: Query by PR
- **WHEN** querying audit records for a specific PR
- **THEN** all review audit records for that PR SHALL be returned in chronological order

#### Scenario: Query by time range
- **WHEN** querying audit records for a time range
- **THEN** records within the range SHALL be returned with pagination

### Requirement: Audit retention
Audit records SHALL be retained for at least 1 year, with configurable retention period.

#### Scenario: Default retention
- **WHEN** a record reaches 1 year old
- **THEN** the system MAY archive or delete the record according to configured retention policy

#### Scenario: Configurable retention
- **WHEN** a custom retention period is configured
- **THEN** the system SHALL use the configured period instead of the default
