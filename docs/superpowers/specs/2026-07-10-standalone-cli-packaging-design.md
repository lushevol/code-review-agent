# Standalone CLI Packaging Design

## Goal

Keep the published `ratan-code-review` package installable from npm with a small,
explicit public surface and versioned runtime package dependencies.

## Scope

- Publish and depend on the runtime packages used across bundle boundaries:
  `agent-config-manager`, `finding-store`, `ratan-ado-api`, and
  `ratan-sonarqube-api`.
- Remove the unused PostgreSQL ORM workspace; SQLite `FindingStore` is the
  production persistence implementation.
- Export only explicit PR startup and finding contracts from the root package.
- Keep third-party npm packages as external runtime dependencies.
- Verify the packed CLI in an empty consumer directory.

## Design

Rslib builds the CLI and narrow programmatic entry points. Runtime packages stay
as normal npm dependencies so native modules such as `better-sqlite3` retain
their supported installation behavior. Release versions are advanced together
when the CLI requires a new runtime-package API. Removed historical bootstrap,
Observable scan, agent-registry, and ORM exports are not compatibility shims;
the narrowed root API is a deliberate breaking release.

## Verification

1. Add a regression test that packs the CLI, installs the tarball into a clean
   temporary project, and runs `ratan-code-review --help`.
2. Run the targeted regression test and the full test suite.
3. Run the workspace build.
4. Pack every changed publishable package, run `npm publish --dry-run`, install
   the tarballs in a clean consumer, and repeat the CLI smoke test.

## Non-goals

- Changing live Azure DevOps review behavior.
- Running a live pull-request review without explicit user authorization and
  a designated test pull request.
