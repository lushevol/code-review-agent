## ADDED Requirements

### Requirement: Policy-as-code rules
The system SHALL support version-controlled compliance rules stored as YAML or HCL files in a `.ratan/code-review-agent/rules/` directory.

#### Scenario: Rule file discovered
- **WHEN** a compliance rule file exists in the configured rules directory
- **THEN** the system SHALL load and parse all rules at pipeline start

#### Scenario: Rule evaluation
- **WHEN** a PR changes a file matching a rule's `file_pattern`
- **THEN** the system SHALL check the changed lines against the rule's constraints

#### Scenario: Rule violation detected
- **WHEN** a changed file matches a rule's pattern and violates a forbidden pattern
- **THEN** the system SHALL generate a finding with category `compliance`

### Requirement: Rule structure
Each compliance rule SHALL define: `rule-id`, `description`, `severity`, `category`, and evaluation patterns.

#### Scenario: Complete rule definition
- **WHEN** a rule file is loaded
- **THEN** the system SHALL validate that the rule contains all required fields

#### Scenario: Invalid rule
- **WHEN** a rule file is malformed or missing required fields
- **THEN** the system SHALL log a warning and skip that rule without failing the pipeline

### Requirement: Rule sources
Rules can be sourced from local filesystem or ADO repository, matching the existing dual-mode config pattern.

#### Scenario: Local rules
- **WHEN** config mode is `local`
- **THEN** rules are read from `.ratan/code-review-agent/rules/` in the local filesystem

#### Scenario: ADO rules
- **WHEN** config mode is `ado`
- **THEN** rules are fetched from the configured ADO repository path, with caching

### Requirement: Built-in compliance checks
The system SHALL include a set of built-in compliance checks for common patterns.

#### Scenario: TODO left in code
- **WHEN** a PR adds a line containing `TODO`, `FIXME`, `XXX`, or `HACK`
- **THEN** the system SHALL generate a `compliance` finding of severity `low`

#### Scenario: Large file changes
- **WHEN** a single file in the PR has more than 400 changed lines
- **THEN** the system SHALL generate a `compliance` finding of severity `informational` recommending smaller PRs
