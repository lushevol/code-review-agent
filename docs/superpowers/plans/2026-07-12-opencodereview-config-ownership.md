# OpenCodeReview Configuration Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make .ratan the only user-facing configuration root, with OpenCodeReview owning LLM settings and native review rules, and remove the obsolete legacy-agent prompt configuration.

**Architecture:** Extend root configuration with openCodeReview.llm and a rule-file path. The loader resolves nested env: tokens and rejects old agent configuration. The scanner passes an unmodified native OpenCodeReview rule file to a runner that writes an isolated temporary OCR config for every review.

**Tech Stack:** TypeScript, Zod 4, Vitest, Node.js filesystem APIs, @alibaba-group/open-code-review 1.7.7.

## Global Constraints

- .ratan/config.json is the sole user-facing configuration entrypoint.
- config.openCodeReview.llm is the sole LLM configuration source; do not fall back to OCR_LLM_* or OPENAI_*.
- .ratan/opencodereview/rule.json is native OpenCodeReview JSON and is passed unchanged through ocr review --rule.
- PR Guardian owns scheduling, integrations, persistence, merge policy, and work-item policy; OpenCodeReview owns review rules and file scope.
- Never persist resolved LLM tokens beneath .ratan or a checked-out repository.
- Existing .ratan installations are not automatically rewritten; obsolete settings produce an actionable migration error.
- Remote ADO configuration mode and AgentConfigClient are removed; the CLI always loads local .ratan configuration.

---

## File Structure

| File | Responsibility |
| --- | --- |
| packages/agent-config-manager/src/types.ts | Reduced root-config contract and OpenCodeReview LLM schema. |
| agents/ratan-code-review-agent/src/cli/config/loader.ts | Nested secret resolution and legacy-config rejection. |
| agents/ratan-code-review-agent/src/cli/config/local-client.ts | Local provider without legacy prompt methods. |
| packages/agent-config-manager/src/config.ts | Removed ADO-backed remote configuration provider. |
| packages/agent-config-manager/src/session.ts | Removed remote-provider session factory. |
| agents/ratan-code-review-agent/src/bootstrap/index.ts | Removes startup APIs that require remote configuration creation. |
| agents/ratan-code-review-agent/src/demo.ts | Removed obsolete remote-config demo entrypoint. |
| agents/ratan-code-review-agent/src/cli/commands/start.ts | New .ratan scaffolding and legacy prompt-directory detection. |
| agents/ratan-code-review-agent/templates/config.json.template | New PR Guardian operational configuration template. |
| agents/ratan-code-review-agent/templates/opencodereview/rule.json.template | Native OpenCodeReview review-rule template. |
| agents/ratan-code-review-agent/src/review/open-code-review/runner.ts | Isolated OCR config and native rule invocation. |
| agents/ratan-code-review-agent/src/review/workflows/scanners/open-code-review-scanner.ts | Rule-path resolution and runner input. |
| agents/ratan-code-review-agent/src/cli/config/*.spec.ts | Configuration and scaffold regression tests. |
| agents/ratan-code-review-agent/src/review/open-code-review/runner.spec.ts | Runner isolation and rule-validation tests. |

### Task 1: Replace the legacy configuration contract

**Files:**
- Modify: packages/agent-config-manager/src/types.ts:21-112
- Modify: agents/ratan-code-review-agent/src/cli/config/loader.ts:12-82
- Modify: agents/ratan-code-review-agent/src/cli/config/local-client.ts:1-116
- Modify: agents/ratan-code-review-agent/src/cli/config/local-client.spec.ts:1-160

**Interfaces:**
- Produces: RootAgentConfig.openCodeReview: { workspaceRoot?: string; rulesPath: string; llm: { url: string; token: string; model: string; useAnthropic?: boolean } }.
- Removes: AgentConfig, defaultAgentConfig, agents, ConfigProvider.getAgentConfig(), and ConfigProvider.buildPrompt().

- [ ] **Step 1: Write failing configuration tests**

~~~ts
it("retains OpenCodeReview settings in the root config", async () => {
  const client = new LocalConfigClient({
    configDir: FIXTURES_DIR,
    config: {
      openCodeReview: {
        rulesPath: "opencodereview/rule.json",
        llm: { url: "https://llm.example/v1", token: "secret", model: "model" },
      },
    },
    ado: { organization: "o", project: "p" },
  });
  expect((await client.getRootConfig()).openCodeReview?.llm.model).toBe("model");
});
~~~

Delete prompt and agent lookup tests because that API is being removed. Add loader tests asserting a nested env:OCR_LLM_TOKEN is resolved and config.agents rejects with a migration message naming config.openCodeReview and opencodereview/rule.json.

- [ ] **Step 2: Run the focused tests**

Run: pnpm --filter ratan-code-review exec vitest run src/cli/config/local-client.spec.ts

Expected: FAIL because openCodeReview.llm is not yet defined.

- [ ] **Step 3: Implement the new schema and narrow the provider**

~~~ts
const OpenCodeReviewLlmConfigSchema = z.object({
  url: z.string().url(),
  token: z.string().min(1),
  model: z.string().min(1),
  useAnthropic: z.boolean().optional().default(false),
});
const OpenCodeReviewConfigSchema = z.object({
  workspaceRoot: z.string().optional(),
  rulesPath: z.string().min(1),
  llm: OpenCodeReviewLlmConfigSchema,
});
~~~

Remove legacy agent fields and methods. Replace top-level-only secret resolution with a recursive resolver for strings, arrays, and plain objects. Before provider creation, reject config.agents and config.defaultAgentConfig explicitly so Zod does not silently strip them.

- [ ] **Step 4: Verify and commit**

Run: pnpm --filter ratan-code-review exec vitest run src/cli/config/local-client.spec.ts

Expected: PASS.

~~~bash
git add packages/agent-config-manager/src/types.ts agents/ratan-code-review-agent/src/cli/config/loader.ts agents/ratan-code-review-agent/src/cli/config/local-client.ts agents/ratan-code-review-agent/src/cli/config/local-client.spec.ts
git commit -m "refactor: replace legacy agent config with OCR settings"
~~~

### Task 2: Scaffold the two-file .ratan OpenCodeReview configuration

**Files:**
- Modify: agents/ratan-code-review-agent/src/cli/commands/start.ts:23-78
- Modify: agents/ratan-code-review-agent/templates/config.json.template:1-46
- Create: agents/ratan-code-review-agent/templates/opencodereview/rule.json.template
- Delete: agents/ratan-code-review-agent/templates/prompts/review.md.template
- Delete: agents/ratan-code-review-agent/templates/prompts/review-rescore.md.template
- Delete: agents/ratan-code-review-agent/templates/prompts/issue-classification.md.template
- Delete: agents/ratan-code-review-agent/templates/prompts/summary.md.template
- Modify: agents/ratan-code-review-agent/src/cli/config/scaffold.spec.ts:1-31

**Interfaces:**
- Produces: .ratan/config.json, .ratan/opencodereview/rule.json, .ratan/data/, and .ratan/logs/; never creates .ratan/prompts/.

- [ ] **Step 1: Write failing scaffold tests**

~~~ts
expect(rootConfig.openCodeReview).toMatchObject({
  rulesPath: "opencodereview/rule.json",
  llm: { model: "your-review-model" },
});
await expect(readFile(path.join(ratanDir, "opencodereview/rule.json"), "utf8"))
  .resolves.toContain('"rules"');
expect(existsSync(path.join(ratanDir, "prompts"))).toBe(false);
~~~

Add a second test that places prompts/ in an existing .ratan directory and expects an error that tells the user to migrate to opencodereview/rule.json.

- [ ] **Step 2: Run the focused test**

Run: pnpm --filter ratan-code-review exec vitest run src/cli/config/scaffold.spec.ts

Expected: FAIL because the existing scaffold creates prompt files.

- [ ] **Step 3: Replace templates and scaffolding**

Use this root config:

~~~json
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
~~~

Create the native rule template:

~~~json
{
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["**/*.test.*", "**/*.spec.*", "**/generated/**"],
  "rules": [{ "path": "**/*", "rule": "Report correctness, security, reliability, and maintainability issues. Do not report formatting-only suggestions." }]
}
~~~

Create opencodereview/ and copy the rule template in ensureRatanFolder(). Delete prompt-directory creation and the prompt-copy loop. If an existing prompts/ directory is present, throw the migration error before review work starts.

- [ ] **Step 4: Verify and commit**

Run: pnpm --filter ratan-code-review exec vitest run src/cli/config/scaffold.spec.ts

Expected: PASS.

~~~bash
git add agents/ratan-code-review-agent/src/cli/commands/start.ts agents/ratan-code-review-agent/templates agents/ratan-code-review-agent/src/cli/config/scaffold.spec.ts
git commit -m "feat: scaffold OpenCodeReview configuration"
~~~

### Task 3: Pass resolved OCR config and native rules into every review

**Files:**
- Modify: agents/ratan-code-review-agent/src/review/open-code-review/runner.ts:47-252
- Modify: agents/ratan-code-review-agent/src/review/open-code-review/runner.spec.ts:1-170
- Modify: agents/ratan-code-review-agent/src/review/workflows/scanners/open-code-review-scanner.ts:17-47
- Modify: agents/ratan-code-review-agent/src/review/workflows/scanners/scanner-pipeline.ts:86-204
- Modify: packages/agent-config-manager/src/types.ts
- Modify: agents/ratan-code-review-agent/src/cli/config/local-client.ts

**Interfaces:**
- Consumes: resolved openCodeReview.llm and a provider resolveConfigPath(relativePath: string): string.
- Produces: OcrReviewInput.llm and OcrReviewInput.ruleFile, an isolated `$HOME/.opencodereview/config.json`, and --rule <ruleFile>.

- [ ] **Step 1: Write failing runner tests**

Make the fake OCR binary capture its argument list and the file at `$HOME/.opencodereview/config.json`. Assert:

~~~ts
expect(capture.args).toEqual(expect.arrayContaining(["--rule", ruleFile]));
expect(capture.config).toMatchObject({
  llm: { url: "https://llm.example/v1", auth_token: "secret", model: "model", use_anthropic: false },
});
~~~

Add tests that reject a nonexistent rule file with OpenCodeReview rule file not found and invalid JSON with OpenCodeReview rule file is invalid.

- [ ] **Step 2: Run the runner tests**

Run: pnpm --filter ratan-code-review exec vitest run src/review/open-code-review/runner.spec.ts

Expected: FAIL because the runner currently builds settings from process environment and writes an empty generated rule file.

- [ ] **Step 3: Change runner and scanner inputs**

~~~ts
export interface OcrReviewInput {
  workspace: ReviewWorkspace;
  background: string;
  llm: { url: string; token: string; model: string; useAnthropic: boolean };
  ruleFile: string;
}
~~~

Validate ruleFile exists and parses as JSON; pass its original path unchanged to --rule. Write this into temporary stateHome/config.json:

~~~ts
{ llm: {
  url: input.llm.url,
  auth_token: input.llm.token,
  model: input.llm.model,
  use_anthropic: input.llm.useAnthropic,
} }
~~~

Remove OCR_LLM_* and OPENAI_* fallback lookup from the runner. Add resolveConfigPath() to ConfigProvider and implement it in the local provider. In OpenCodeReviewScanner, require rootConfig.openCodeReview, resolve rulesPath, and pass its LLM settings and rule file to the runner. Remove filePathsAllowlist and filePathsBlocklist as scanner inputs: native OCR rules become the only file-scope source.

- [ ] **Step 4: Verify and commit**

Run: pnpm --filter ratan-code-review exec vitest run src/review/open-code-review/runner.spec.ts src/review/workflows/scanners/scanner-pipeline.integration.spec.ts

Expected: PASS.

~~~bash
git add agents/ratan-code-review-agent/src/review/open-code-review/runner.ts agents/ratan-code-review-agent/src/review/open-code-review/runner.spec.ts agents/ratan-code-review-agent/src/review/workflows/scanners/open-code-review-scanner.ts agents/ratan-code-review-agent/src/review/workflows/scanners/scanner-pipeline.ts packages/agent-config-manager/src/types.ts agents/ratan-code-review-agent/src/cli/config/local-client.ts
git commit -m "feat: run OCR from .ratan configuration"
~~~

### Task 4: Remove stale documentation and run package verification

**Files:**
- Modify: README.md:65-190
- Modify: agents/ratan-code-review-agent/docs/RUNTIME_ARCHITECTURE.md:1-132
- Modify: agents/ratan-code-review-agent/docs/AI_HARNESS.md:1-225

- [ ] **Step 1: Identify and replace obsolete setup instructions**

Run: rg -n "review-rescore|issue-classification|defaultAgentConfig|agents\\.review|OPENAI_BASE_URL|OPENAI_API_KEY" README.md agents/ratan-code-review-agent/docs agents/ratan-code-review-agent/templates

Replace active-usage instructions with .ratan/config.json and .ratan/opencodereview/rule.json. Explain config.openCodeReview.llm and env:NAME, and state that include/exclude/rules are native OCR rule-file settings.

- [ ] **Step 2: Update the runtime diagram and setup examples**

Show OpenCodeReview as the active review scanner. Do not document review/rescore/classify/summary as an active runtime path or environment variables as a fallback LLM configuration source.

- [ ] **Step 3: Run verification**

~~~bash
pnpm --filter ratan-code-review exec vitest run src/cli/config/scaffold.spec.ts src/cli/config/local-client.spec.ts src/review/open-code-review/runner.spec.ts src/review/workflows/scanners/scanner-pipeline.integration.spec.ts
pnpm --filter ratan-code-review typecheck
pnpm --filter agent-config-manager build
pnpm --filter ratan-code-review build
~~~

Expected: every command exits 0.

- [ ] **Step 4: Inspect scope and commit**

Run: gitnexus detect_changes()

Expected: only configuration, scanner, runner, template, test, and documentation flows are affected.

~~~bash
git add README.md agents/ratan-code-review-agent/docs/RUNTIME_ARCHITECTURE.md agents/ratan-code-review-agent/docs/AI_HARNESS.md
git commit -m "docs: document OpenCodeReview configuration"
~~~

## Plan Self-Review

- Spec coverage: Task 1 defines explicit ownership and migration rejection; Task 2 creates the new .ratan contract; Task 3 injects isolated LLM config and native rules; Task 4 removes stale documentation and verifies the result.
- Placeholder scan: no deferred implementation step remains.
- Type consistency: RootAgentConfig.openCodeReview.llm is defined in Task 1 and consumed by the scanner and runner in Task 3. The resolveConfigPath() contract is introduced before scanner use.
