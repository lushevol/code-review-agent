# Standalone CLI Packaging Design

## Goal

Make the published `ratan-code-review` package installable from npm without
requiring the repository's internal workspace packages to be published.

## Scope

- Bundle the CLI's six internal workspace dependencies into its build output:
  `agent-config-manager`, `finding-store`, `ratan-ado-api`,
  `ratan-code-review-agent-orm`, `ratan-markdown-tool`, and
  `ratan-sonarqube-api`.
- Keep third-party npm packages as external runtime dependencies.
- Verify the packed CLI in an empty consumer directory.

## Design

The CLI package will no longer publish internal workspace packages as npm
dependencies. They will remain available to the local build as development
dependencies. Its Rslib configuration will bundle those development
dependencies, while the package's third-party runtime dependencies remain
external and are installed normally by npm.

This preserves the existing CLI API and command behavior. It changes only how
the published distribution obtains code that already lives in this monorepo.

## Verification

1. Add a regression test that packs the CLI, installs the tarball into a clean
   temporary project, and runs `ratan-code-review --help`.
2. Run the targeted regression test and the full test suite.
3. Run the workspace build.
4. Pack the CLI, run `npm publish --dry-run` on its tarball, and repeat the
   clean-consumer install smoke test.

## Non-goals

- Publishing the six internal packages individually.
- Changing live Azure DevOps review behavior.
- Running a live pull-request review without explicit user authorization and
  a designated test pull request.
