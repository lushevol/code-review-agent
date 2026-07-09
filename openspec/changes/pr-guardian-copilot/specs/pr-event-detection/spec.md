## ADDED Requirements

### Requirement: PR creation detection
The system SHALL automatically trigger a full review when a new pull request is created in a monitored repository.

#### Scenario: New PR triggers review
- **WHEN** a new pull request is created in a pilot repository
- **THEN** the system SHALL start the review pipeline within 30 seconds

#### Scenario: PR update triggers re-review
- **WHEN** new commits are pushed to the source branch of an existing pull request
- **THEN** the system SHALL start a re-review within 30 seconds

### Requirement: Webhook-based detection
The system SHALL accept Azure DevOps service hook events for `pullrequest.created` and `pullrequest.updated` as the primary detection mechanism.

#### Scenario: Webhook triggers review
- **WHEN** an ADO service hook delivers a `pullrequest.created` event
- **THEN** the system SHALL validate the event payload and enqueue a review job

#### Scenario: Invalid webhook payload
- **WHEN** the webhook payload is malformed or missing required fields
- **THEN** the system SHALL log a warning and discard the event without triggering a review

### Requirement: Polling fallback
The system SHALL support polling-based PR detection for repositories where webhooks cannot be configured.

#### Scenario: Polling discovers new PR
- **WHEN** the polling loop finds a PR that has not been reviewed for the current commit
- **THEN** the system SHALL trigger a review for that PR

#### Scenario: Polling interval
- **WHEN** polling mode is active
- **THEN** the polling interval SHALL be configurable with a minimum of 30 seconds

### Requirement: Duplicate detection
The system SHALL not start duplicate reviews for the same PR commit hash.

#### Scenario: Duplicate event suppression
- **WHEN** the system receives a second event for the same PR and same commit hash
- **THEN** the system SHALL skip the review and log the duplicate event

### Requirement: Eligibility gate
Before triggering a review, the system SHALL check that the repository is in the configured pilot list and the PR meets minimum size/build gate criteria.

#### Scenario: Ineligible repository skipped
- **WHEN** a PR event is received for a repository not in the pilot list
- **THEN** the system SHALL skip the review and log the reason

#### Scenario: Draft PR handling
- **WHEN** a PR is in draft state
- **THEN** the system SHALL skip the review until the PR is marked ready for review
