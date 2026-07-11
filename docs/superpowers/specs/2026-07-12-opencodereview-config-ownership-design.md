# OpenCodeReview Configuration Ownership

## Goal

Make `.ratan` the single user-facing configuration root while making
OpenCodeReview the sole owner of LLM-review semantics. Remove obsolete legacy
agent prompts and configuration.

## Ownership

PR Guardian owns operations and governance:

- Azure DevOps connectivity, PR discovery, scheduling, and comments
- finding persistence, audit records, feedback, and dashboard data
- SonarQube and compliance scanner settings
- merge policy and work-item creation

OpenCodeReview owns code-review semantics:

- LLM connection settings
- file include and exclude patterns
- review rules

## Files

New installations create these files beneath `.ratan`:

```text
.ratan/
├── config.json
├── opencodereview/
│   └── rule.json
├── data/
└── logs/
```

`config.json` remains the wrapper configuration entrypoint. Its local-mode
root configuration contains an `openCodeReview` block:

```json
{
  "openCodeReview": {
    "workspaceRoot": ".ratan/workspaces",
    "rulesPath": "opencodereview/rule.json",
    "llm": {
      "url": "env:OCR_LLM_URL",
      "token": "env:OCR_LLM_TOKEN",
      "model": "your-review-model",
      "useAnthropic": false
    }
  }
}
```

Secret references use `env:NAME` and are resolved when the local configuration
is loaded. The resolved secret values are never saved back to `.ratan`.

`.ratan/opencodereview/rule.json` uses the native OpenCodeReview rule schema
without translation by PR Guardian:

```json
{
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["**/*.test.*", "**/*.spec.*", "**/generated/**"],
  "rules": [
    {
      "path": "**/*",
      "rule": "Report correctness, security, reliability, and maintainability issues. Do not report formatting-only suggestions."
    }
  ]
}
```

## Runtime behavior

`OpenCodeReviewRunner` receives resolved OpenCodeReview configuration from the
PR Guardian config provider. For each review, it writes the LLM settings to an
isolated temporary OpenCodeReview config at `OCR_CONFIG_PATH`, passes the
configured rule file directly through `ocr review --rule`, and removes the
temporary home after the review.

The runner no longer reads `OCR_LLM_*` or `OPENAI_*` as configuration fallbacks.
Configuration is explicit in `.ratan/config.json`.

If LLM settings are missing, the startup or review error names
`config.openCodeReview.llm`. If the rule file is missing, unreadable, or invalid,
the review is incomplete, the merge gate remains pending, and the PR comment
requests manual review.

## Migration

Remove legacy configuration and scaffolding:

- `defaultAgentConfig`
- `agents`
- `prompts/` scaffolded directory and all prompt templates

The active root-config schema no longer accepts those fields. Existing
installations are not modified automatically. At startup, detected legacy
fields or prompt directories cause a migration error that identifies the two
required replacement files: `config.json` with `openCodeReview` settings and
`opencodereview/rule.json`.

## Verification

Tests cover:

- new `.ratan` scaffolding with only the new config and rule template;
- nested `env:` resolution for OpenCodeReview LLM settings;
- generated temporary OpenCodeReview configuration and rule-file pass-through;
- missing LLM configuration;
- missing or malformed rule file producing an incomplete review;
- rejection of legacy configuration fields and prompt scaffolding.

Documentation is updated to present OpenCodeReview as the active review engine
and the former review/rescore/classify/summary system as removed, rather than
as a runtime path.
