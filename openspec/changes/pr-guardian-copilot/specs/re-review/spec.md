## ADDED Requirements

### Requirement: Re-review on commit
When new commits are pushed to the PR source branch, the system SHALL re-run the full review pipeline.

#### Scenario: New commit triggers re-review
- **WHEN** a new commit is pushed to the source branch of an existing PR
- **THEN** the system SHALL start a full review pipeline for the new commit

#### Scenario: Review in progress skipped
- **WHEN** a new commit is pushed while a review for the previous commit is still running
- **THEN** the system SHALL cancel the running review and start a new one for the latest commit

### Requirement: Finding reconciliation
After re-review, the system SHALL reconcile findings between the previous and current review results.

#### Scenario: Remediated finding resolved
- **WHEN** a finding from the previous review does not appear in the new review results
- **THEN** the previous finding SHALL be marked `resolution = 'resolved'` with the new commit hash

#### Scenario: Same finding persists
- **WHEN** a finding from the previous review has the same identity in the new review
- **THEN** the new finding SHALL be created with the latest commit context, and the previous finding SHALL be marked as `superseded`

#### Scenario: New finding detected
- **WHEN** a finding appears in the new review that did not exist in the previous review
- **THEN** the finding SHALL be created with `resolution = 'open'`

### Requirement: Finding identity
Finding identity for reconciliation SHALL be computed as a hash of `(filePath, lineStart, category, title)`.

#### Scenario: Same identity detection
- **WHEN** a finding from the new review has the same identity hash as a finding from the previous review
- **THEN** the system SHALL treat them as the same finding

#### Scenario: Changed line number
- **WHEN** a finding is about the same code area but at different line numbers (within a configurable tolerance)
- **THEN** the system SHALL still consider it the same finding if the content context hash matches

### Requirement: Re-reviewed PR comment updates
The system SHALL update the PR summary comment to reflect the latest review state, noting which findings were resolved or superseded.

#### Scenario: Updated summary comment
- **WHEN** a re-review completes
- **THEN** the PR summary comment SHALL include a "Changes since last review" section showing resolved and new findings
