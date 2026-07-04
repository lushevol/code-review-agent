## ADDED Requirements

### Requirement: Finding override
Authorized users SHALL be able to override a finding with a status of `waived`, `false-positive`, or `accepted-risk`.

#### Scenario: Waive a finding
- **WHEN** an authorized user submits a waiver request for a finding
- **THEN** the finding's resolution SHALL be set to `waived` with the user's identity, justification, and expiry date recorded

#### Scenario: Mark false positive
- **WHEN** an authorized user marks a finding as false positive
- **THEN** the finding's resolution SHALL be set to `false-positive` with the user's identity and justification

#### Scenario: Accept risk
- **WHEN** an authorized user accepts the risk of a finding
- **THEN** the finding's resolution SHALL be set to `accepted-risk` with the user's identity, justification, and expiry date

### Requirement: Override authorization
Overrides SHALL require an authorized user. For findings with severity `critical`, a two-person approval SHALL be required.

#### Scenario: Critical override requires two approvals
- **WHEN** a user attempts to override a `critical` finding
- **THEN** the system SHALL record the request as pending and require a second authorized user to confirm

#### Scenario: Single-user override for high severity
- **WHEN** a user attempts to override a `high` severity finding
- **THEN** a single authorized user SHALL be sufficient

### Requirement: Override expiry
Overrides with type `waived` or `accepted-risk` SHALL have an expiry date. After expiry, the finding SHALL revert to `resolution = 'open'`.

#### Scenario: Expired waiver
- **WHEN** the current date exceeds the override's expiry date
- **THEN** the system SHALL revert the finding to `open` and log the reversion in the audit trail

#### Scenario: Override renewal
- **WHEN** an authorized user renews an override before expiry
- **THEN** the expiry date SHALL be extended and the change logged in the audit trail

### Requirement: Override audit trail
Every override action SHALL be recorded with the user identity, timestamp, previous resolution, new resolution, justification, and (if applicable) second approver.

#### Scenario: Override logging
- **WHEN** any override action is taken
- **THEN** an audit record SHALL be created with the user, timestamp, old and new resolution, and justification

#### Scenario: Override retrieval
- **WHEN** querying the audit trail for a specific finding
- **THEN** all override events for that finding SHALL be returned in chronological order
