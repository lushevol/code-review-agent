# ConfigProvider interface for dual-mode config loading

We added a `ConfigProvider` interface to the `agent-config-manager` package so both the existing `AgentConfigClient` (ADO-backed) and the new `LocalConfigClient` (filesystem-backed) can be used interchangeably by `AgentConfigSession` and the CLI. Without a shared interface, the CLI would need duck-typing or conditional branches everywhere a config object is passed around — fragile and unclear to future readers.

**Considered Options:**
1. **Formal interface in agent-config-manager** (chosen) — add `ConfigProvider` to the shared package, type the session against it. Type-safe, self-documenting, but requires a change to the shared package's public API.
2. **Duck-typing in the CLI** — `LocalConfigClient` in the CLI package with the same method signatures, no shared interface. Fewer files changed but no compile-time guarantees that the shapes match, and the implicit contract is invisible to new developers.

We picked option 1 because type safety at the package boundary is worth the extra interface file, and the agent-config-manager package is the natural home for config abstractions.
