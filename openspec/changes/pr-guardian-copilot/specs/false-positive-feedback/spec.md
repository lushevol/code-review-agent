## ADDED Requirements

### Requirement: Per-finding feedback
Each finding SHALL support feedback from authorized users indicating the accuracy and usefulness of the finding.

#### Scenario: Feedback options
- **WHEN** a user provides feedback on a finding
- **THEN** they SHALL select from: `true-positive`, `false-positive`, `lack-of-context`, `by-design`, `risk-accepted`, `already-addressed`

#### Scenario: Feedback submission
- **WHEN** a user submits feedback
- **THEN** the feedback SHALL be stored with the finding, including the user identity, timestamp, and optional comment

### Requirement: Feedback aggregation
The system SHALL aggregate feedback for dashboard reporting and model/rules improvement.

#### Scenario: FP rate calculation
- **WHEN** calculating false-positive rate
- **THEN** the system SHALL divide the count of `false-positive` feedback by total feedback received

#### Scenario: Per-source accuracy
- **WHEN** reporting accuracy metrics
- **THEN** the system SHALL break down feedback by `sourceEngine` to show per-scanner accuracy

### Requirement: Feedback-driven improvement
Feedback data SHALL be available for prompt tuning and rule refinement.

#### Scenario: Export feedback
- **WHEN** an administrator requests feedback data
- **THEN** the system SHALL export feedback records in JSON or CSV format

#### Scenario: High-FP rule flagging
- **WHEN** a specific compliance rule has a false-positive rate above a configurable threshold (default 30%)
- **THEN** the system SHALL log an alert recommending rule review
