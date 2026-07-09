## ADDED Requirements

### Requirement: Automatic task creation
The system SHALL automatically create Azure DevOps work items for findings with severity `critical` or `high`.

#### Scenario: Critical finding creates Bug
- **WHEN** a finding has severity `critical`
- **THEN** the system SHALL create an ADO work item of type `Bug` with the finding title, description, evidence, and remediation recommendation

#### Scenario: High finding creates Task
- **WHEN** a finding has severity `high`
- **THEN** the system SHALL create an ADO work item of type `Task` with the finding title, description, evidence, and remediation recommendation

#### Scenario: Medium or lower finding skipped
- **WHEN** a finding has severity `medium`, `low`, or `informational`
- **THEN** the system SHALL NOT create a work item

### Requirement: Work item linkage
Each created work item SHALL be linked to the PR and the work item ID SHALL be stored in the finding's `linkedTaskId` field.

#### Scenario: Work item-PR link
- **WHEN** a work item is created for a finding
- **THEN** the system SHALL add an artifact link from the work item to the ADO pull request

#### Scenario: Finding updated with task ID
- **WHEN** a work item is created
- **THEN** the finding's `linkedTaskId` SHALL be set to the new work item ID

### Requirement: Task creation idempotency
The system SHALL NOT create duplicate work items for the same finding across multiple review runs.

#### Scenario: Re-review does not duplicate
- **WHEN** a re-review produces a finding identical to one from the previous review that already has a linked work item
- **THEN** the system SHALL NOT create a new work item

#### Scenario: Finding identity for dedup
- **WHEN** checking for existing work items
- **THEN** the system SHALL use the finding identity `(filePath, lineStart, category, title)` to match against previous findings with linked tasks

### Requirement: Task title and description
Work item title SHALL include the finding title prefixed with `[PR Guardian]` and the PR ID. Description SHALL include the full finding details and a link back to the PR.

#### Scenario: Work item title format
- **WHEN** a work item is created
- **THEN** the title SHALL be `[PR Guardian] <finding title> (PR #<prId>)`

#### Scenario: Work item description
- **WHEN** a work item is created
- **THEN** the description SHALL include the finding category, severity, evidence, business impact, remediation, and a link to the PR
