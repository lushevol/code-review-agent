## ADDED Requirements

### Requirement: Finding taxonomy
The system SHALL assign every finding exactly one category from: `bug`, `security`, `compliance`, `cve`, `dependency`, `secret`, `quality`.

#### Scenario: Categorization of a code logic error
- **WHEN** the AI review identifies a null pointer dereference in changed code
- **THEN** the finding SHALL have category `bug`

#### Scenario: Categorization of a hardcoded credential
- **WHEN** the secret scanner finds a plaintext API key in a changed file
- **THEN** the finding SHALL have category `secret`

#### Scenario: Categorization of a CVE finding
- **WHEN** the CVE scanner reports a vulnerable dependency in the PR's changed manifests
- **THEN** the finding SHALL have category `cve`

### Requirement: Severity assignment
Every finding SHALL have a severity level from: `critical`, `high`, `medium`, `low`, `informational`.

#### Scenario: Critical severity logic
- **WHEN** a finding involves direct remote code execution, authentication bypass, or exposed secrets
- **THEN** the system SHALL assign severity `critical`

#### Scenario: High severity logic
- **WHEN** a finding involves SQL injection, sensitive data exposure, or broken access control
- **THEN** the system SHALL assign severity `high`

#### Scenario: Medium severity logic
- **WHEN** a finding involves input validation gaps, error handling weaknesses, or minor compliance deviations
- **THEN** the system SHALL assign severity `medium`

### Requirement: Confidence score
Every finding SHALL include a confidence score between 0.0 and 1.0, where 1.0 represents full certainty.

#### Scenario: Deterministic scanner confidence
- **WHEN** the finding originates from a deterministic scanner (e.g., CVE, secret scanner)
- **THEN** the confidence SHALL be 1.0

#### Scenario: AI review confidence
- **WHEN** the finding originates from the AI review agent
- **THEN** the confidence SHALL reflect the model's assessed certainty

### Requirement: Evidence capture
Every finding SHALL include an evidence field containing the relevant code excerpt, scanner output, or context that supports the finding.

#### Scenario: Evidence from code diff
- **WHEN** the AI review flags a code issue
- **THEN** the evidence field SHALL include the relevant diff lines or surrounding context

#### Scenario: Evidence from scanner output
- **WHEN** the CVE scanner identifies a vulnerable dependency
- **THEN** the evidence field SHALL include the scanner's output (package name, version, CVE ID, severity)

### Requirement: Business impact
Every finding SHALL include a business impact statement describing the potential consequence if the finding is not addressed.

#### Scenario: Business impact for CVE
- **WHEN** a finding is a critical CVE
- **THEN** the business impact SHALL describe the exploitation risk and potential data exposure

#### Scenario: Business impact for compliance
- **WHEN** a finding is a compliance violation
- **THEN** the business impact SHALL reference the violated policy and potential regulatory consequence

### Requirement: Remediation recommendation
Every finding SHALL include a concrete remediation recommendation that the developer can act on.

#### Scenario: Remediation for bug finding
- **WHEN** a finding is a null pointer dereference
- **THEN** the remediation SHALL suggest adding a null check or using Optional

#### Scenario: Remediation for CVE finding
- **WHEN** a finding is a vulnerable dependency
- **THEN** the remediation SHALL specify the patched version or suggested replacement package
