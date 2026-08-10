# TODO

## Live operation

- [x] Load ADO credentials and OCR endpoint/model/token through `.ratan/config.json`
  with `env:NAME` secret references.
- [x] Support direct ADO access with `ADO_PROXY_URL=none`.
- [x] Provide one-shot, explicit-PR, and watch-mode CLI flows.
- [x] Persist findings, thread links, overrides, and audit records in SQLite.
- [x] Provide reusable registry/ADO/review verification scripts.
- [ ] Keep live review targets bounded to dedicated test PRs and inspect the
  newest canonical conclusion after every release. *(Ongoing release control;
  requires an explicitly authorized PR cohort and scoped ADO credentials.)*
- [x] Add deployment authentication/authorization before exposing the dashboard
  outside a trusted network.
- [x] Add graceful webhook shutdown and production deployment guidance.

## Evaluation and review quality

- [x] Maintain a 27-case multilingual synthetic golden corpus with clean controls,
  including rename and deletion coverage.
- [x] Keep deterministic matching as the pass/fail authority.
- [x] Offer an opt-in qualitative LLM judge for false-positive and suggestion
  quality evidence without changing deterministic results.
- [x] Expand golden rename/deletion coverage only with representative fixtures.
- [ ] Calibrate the qualitative judge on a larger human-reviewed sample.
  *(Blocked until a representative human-scored sample is supplied.)*
- [ ] Continue real continuation-commit pilots for new, unchanged, and resolved
  findings. *(Requires an explicitly authorized test PR and scoped live
  credentials.)*

## Operations

- [x] Build and test the dashboard findings, audit, override, stats, PR, and queue
  functions.
- [x] Verify publishable tarballs in a clean npm consumer.
- [ ] Verify registry installation on Windows 11. *(Requires a Windows 11 host
  or a pushed branch that can run Windows CI.)*
- [x] Add FindingStore schema migrations before the next persistent schema change.
- [x] Review dashboard bundle splitting if the SPA grows beyond the current Vite
  large-chunk warning.
