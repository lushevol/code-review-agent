## ADDED Requirements

### Requirement: Secret detection
The system SHALL scan PR diff content for secrets, credentials, tokens, and other sensitive strings beyond the existing `maskSensitiveData` function.

#### Scenario: API key detected
- **WHEN** a PR diff contains a line matching a known secret pattern (e.g., `sk-...` for Stripe, `ghp_...` for GitHub tokens)
- **THEN** the system SHALL generate a finding with category `secret`

#### Scenario: Hardcoded password detected
- **WHEN** a PR diff contains an assignment of a literal string to a variable named `password`, `secret`, `token`, or `api_key`
- **THEN** the system SHALL generate a finding with category `secret`

#### Scenario: Private key detected
- **WHEN** a PR diff contains a line starting with `-----BEGIN` in a non-vendor source file
- **THEN** the system SHALL generate a finding with category `secret`

### Requirement: Secret pattern configuration
Secret detection patterns SHALL be configurable via the system configuration, supporting custom regex patterns.

#### Scenario: Custom pattern registration
- **WHEN** a team defines a custom secret pattern in configuration
- **THEN** the secret scanner SHALL check all PR diffs against the custom pattern

#### Scenario: Pattern suppression
- **WHEN** a known test fixture contains a string that matches a secret pattern
- **THEN** the configuration SHALL support per-path or per-file suppression of specific patterns

### Requirement: False-positive reduction
The secret scanner SHALL exclude files in vendor directories, generated code, and test fixtures from secret scanning by default.

#### Scenario: Vendor directory exclusion
- **WHEN** a secret-like string appears in `node_modules/`, `vendor/`, or `.git/`
- **THEN** the system SHALL NOT generate a finding

#### Scenario: Test fixture detection
- **WHEN** a secret-like string appears in a file matched by configured exclusion patterns
- **THEN** the system SHALL NOT generate a finding
