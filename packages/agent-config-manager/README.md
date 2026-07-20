# agent-config-manager

Configuration contracts and providers for PR Guardian Copilot.

The package exports `ConfigProvider`, root Zod configuration schemas,
`AgentConfigClient` for ADO-backed configuration, and `AgentConfigSession` for
runtime provider registration. Persistence is not part of this package; the
removed PostgreSQL ORM accessor is intentionally not retained.

```bash
pnpm --filter agent-config-manager build
```
