# TODO

## Live operation

- [x] Load ADO credentials and OCR endpoint/model/token through `.ratan/config.json`
  with `env:NAME` secret references.
- [x] Support direct ADO access with `ADO_PROXY_URL=none`.
- [x] Provide one-shot, explicit-PR, and watch-mode CLI flows.
- [x] Persist findings, thread links, overrides, and audit records in SQLite.
- [x] Provide reusable registry/ADO/review verification scripts.
- [ ] Keep live review targets bounded to dedicated test PRs and inspect the
  newest canonical conclusion after every release.
- [ ] Add deployment authentication/authorization before exposing the dashboard
  outside a trusted network.
- [ ] Add graceful webhook shutdown and production deployment guidance.

## Evaluation and review quality

- [x] Maintain a 25-case multilingual synthetic golden corpus with clean controls.
- [x] Keep deterministic matching as the pass/fail authority.
- [x] Offer an opt-in qualitative LLM judge for false-positive and suggestion
  quality evidence without changing deterministic results.
- [ ] Expand golden rename/deletion coverage only with representative fixtures.
- [ ] Calibrate the qualitative judge on a larger human-reviewed sample.
- [ ] Continue real continuation-commit pilots for new, unchanged, and resolved
  findings.

## Operations

- [x] Build and test the dashboard findings, audit, override, stats, PR, and queue
  functions.
- [x] Verify publishable tarballs in a clean npm consumer.
- [ ] Verify registry installation on Windows 11.
- [ ] Add FindingStore schema migrations before the next persistent schema change.
- [ ] Review dashboard bundle splitting if the SPA grows beyond the current Vite
  large-chunk warning.
