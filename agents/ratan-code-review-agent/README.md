# ratan-code-review

Azure DevOps PR review CLI and narrow programmatic entry point for PR Guardian
Copilot.

```bash
npm install -g ratan-code-review
ratan-code-review --help
ratan-code-review start --pr-id 123
ratan-code-review dashboard
```

The root module exports `startReviewPrWithProvider` plus the normalized-finding
schemas, types, and hash/id helpers. TypeScript declarations are included in the
package. Workflow internals, scanners, evaluation helpers, dashboard services,
and persistence implementations are intentionally not public root exports.

Live `start` commands can post Azure DevOps comments and statuses. Configure ADO
and `config.openCodeReview.llm` in the generated `.ratan/config.json`; use
`env:NAME` references for secrets.
