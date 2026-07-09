# ratan-code-review NPM CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the existing code review agent as a publishable npm CLI with `scan`, `studio`, and `init` commands supporting local and ADO config modes.

**Architecture:** Add a `ConfigProvider` interface to `agent-config-manager` that both `AgentConfigClient` (ADO) and new `LocalConfigClient` (filesystem) implement. The CLI is additive — new `src/cli/` directory with commander-based command handling, `bin/` shebang shim, and a config loader that resolves `"env:VAR_NAME"` token references. Existing workflow code is untouched; only `bootstrap/session.ts` and `bootstrap/index.ts` are adapted to accept `ConfigProvider`.

**Tech Stack:** TypeScript, commander (CLI), rslib (build), plain TypeScript review runtime (agent framework)

---

### Task 1: Add ConfigProvider interface to agent-config-manager

**Files:**
- Modify: `packages/agent-config-manager/src/types.ts`
- Modify: `packages/agent-config-manager/src/config.ts`
- Modify: `packages/agent-config-manager/src/session.ts`

- [ ] **Step 1: Add ConfigProvider interface to types.ts**

Inject the interface right after the existing `PromptContext` export at the bottom of `packages/agent-config-manager/src/types.ts`:

```typescript
import { AzureDevOps } from "ratan-ado-api";
import { SonarQubeClient } from "ratan-sonarqube-api";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { schema } from "ratan-code-review-agent-orm";

export interface ConfigProvider {
  id: string;
  connect(): Promise<void>;
  getRootConfig(): Promise<RootAgentConfig>;
  getAgentConfig(agentName: string): Promise<AgentConfig>;
  buildPrompt(promptKey: string, context?: PromptContext): Promise<string>;
  getAdoClient(): AzureDevOps;
  getSonarQubeClient(): SonarQubeClient;
  getOrmClient(): Promise<NodePgDatabase<typeof schema> & { $client: Pool } | null>;
}
```

- [ ] **Step 2: Import ConfigProvider in types.ts, add dependency references**

Add these imports at the top of `packages/agent-config-manager/src/types.ts`:

```typescript
import type { AzureDevOps } from "ratan-ado-api";
import type { SonarQubeClient } from "ratan-sonarqube-api";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { schema } from "ratan-code-review-agent-orm";
```

- [ ] **Step 3: Verify types.ts compiles**

Run: `pnpm --filter agent-config-manager exec tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Update AgentConfigClient to implement ConfigProvider**

In `packages/agent-config-manager/src/config.ts`, change the class declaration and add the `id` property (already exists as `public id: string`):

```typescript
import { type ConfigProvider } from "./types";

// Change class signature:
export class AgentConfigClient implements ConfigProvider {
```

The class already has all the required methods (`connect`, `getRootConfig`, `getAgentConfig`, `buildPrompt`, `getAdoClient`, `getSonarQubeClient`, `getOrmClient`) with matching signatures. The `id` property is already `public`. No method body changes needed.

- [ ] **Step 5: Verify AgentConfigClient compiles as ConfigProvider**

Run: `pnpm --filter agent-config-manager exec tsc --noEmit`
Expected: No type errors.

- [ ] **Step 6: Update AgentConfigSession to accept ConfigProvider**

In `packages/agent-config-manager/src/session.ts`, replace the entire file:

```typescript
import { type AgentConfigClient, createAgentConfigClient } from "./config";
import type { AgentConfigCreationOptions, ConfigProvider } from "./types";

type AgentSession = {
  id: string;
  config: ConfigProvider;
};

export class AgentConfigSession {
  private agentConfigSessions: Map<string, AgentSession> = new Map();

  constructor() {}

  public async createAgentConfigSession(
    agentConfigCreationOptions: AgentConfigCreationOptions,
  ): Promise<ConfigProvider> {
    const agentConfigClient = await createAgentConfigClient(
      agentConfigCreationOptions,
    );
    this.agentConfigSessions.set(agentConfigClient.id, {
      config: agentConfigClient,
      id: agentConfigClient.id,
    });
    return agentConfigClient;
  }

  public registerProvider(provider: ConfigProvider): ConfigProvider {
    this.agentConfigSessions.set(provider.id, {
      config: provider,
      id: provider.id,
    });
    return provider;
  }

  public getAgentConfigSession(id: string): AgentSession | undefined {
    return this.agentConfigSessions.get(id);
  }

  public clearSessions() {
    this.agentConfigSessions.clear();
  }

  public clearSession(id: string) {
    this.agentConfigSessions.delete(id);
  }
}
```

Key changes:
- `AgentSession.options` field removed (was only used for dedup in `findOrCreateAgentConfigSession` — removed that method)
- `AgentSession.config` typed as `ConfigProvider` instead of `AgentConfigClient`
- Added `registerProvider(provider)` method for CLI to inject pre-created providers
- Removed `findOrCreateAgentConfigSession` (unused outside this file)

- [ ] **Step 7: Rebuild agent-config-manager**

Run: `pnpm --filter agent-config-manager build`
Expected: Build succeeds.

- [ ] **Step 8: Commit**

```bash
git add packages/agent-config-manager/src/types.ts packages/agent-config-manager/src/session.ts packages/agent-config-manager/src/config.ts
git commit -m "feat: add ConfigProvider interface for dual-mode config support"
```

---

### Task 2: Create LocalConfigClient

**Files:**
- Create: `agents/ratan-code-review-agent/src/cli/config/local-client.ts`
- Test: `agents/ratan-code-review-agent/src/cli/config/local-client.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `agents/ratan-code-review-agent/src/cli/config/local-client.spec.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { LocalConfigClient } from "./local-client";
import path from "node:path";

const FIXTURES_DIR = path.resolve(__dirname, "../../../../test-fixtures/local-config");

describe("LocalConfigClient", () => {
  it("reads RootAgentConfig from the config field", async () => {
    const client = new LocalConfigClient({
      configDir: FIXTURES_DIR,
      config: {
        scanRepoNames: ["test-repo"],
        scanPRCreatedDaysAgo: 3,
        agents: {
          review: { prompts: ["prompts/review.md"] },
        },
      },
      ado: { organization: "test-org", project: "test-project" },
      adoToken: "test-token",
    });

    const rootConfig = await client.getRootConfig();
    expect(rootConfig.scanRepoNames).toEqual(["test-repo"]);
    expect(rootConfig.agents.review.prompts).toEqual(["prompts/review.md"]);
  });

  it("reads prompt files from the filesystem", async () => {
    const client = new LocalConfigClient({
      configDir: FIXTURES_DIR,
      config: {
        agents: {
          review: { prompts: ["prompts/review.md"] },
        },
      },
      ado: { organization: "test-org", project: "test-project" },
      adoToken: "test-token",
    });

    const prompt = await client.buildPrompt("review");
    expect(prompt).toContain("review instructions");
  });

  it("returns null ORM client when no connection URL", async () => {
    const client = new LocalConfigClient({
      configDir: FIXTURES_DIR,
      config: { agents: { review: {} } },
      ado: { organization: "o", project: "p" },
      adoToken: "t",
    });
    expect(await client.getOrmClient()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ratan-code-review-agent exec vitest run src/cli/config/local-client.spec.ts`
Expected: FAIL with "Cannot find module" or similar.

- [ ] **Step 3: Create test fixtures**

Create `agents/ratan-code-review-agent/test-fixtures/local-config/prompts/review.md`:

```markdown
review instructions: focus on security and performance.
```

Create `agents/ratan-code-review-agent/test-fixtures/local-config/prompts/summary.md`:

```markdown
summary instructions: provide a concise summary.
```

- [ ] **Step 4: Write LocalConfigClient**

Create `agents/ratan-code-review-agent/src/cli/config/local-client.ts`:

```typescript
import { readFile } from "node:fs/promises";
import path from "node:path";
import Handlebars from "handlebars";
import { AzureDevOps } from "ratan-ado-api";
import { SonarQubeClient } from "ratan-sonarqube-api";
import type {
  AgentConfig,
  ConfigProvider,
  PromptContext,
  RootAgentConfig,
} from "agent-config-manager";
import { v4 } from "uuid";

export interface LocalConfigOptions {
  configDir: string;
  config: RootAgentConfig;
  ado: { organization: string; project: string };
  adoToken?: string;
  sonarQubeToken?: string;
  databaseUrl?: string;
}

export class LocalConfigClient implements ConfigProvider {
  public id: string;
  private options: LocalConfigOptions;
  private adoClient: AzureDevOps | null = null;
  private sonarQubeClient: SonarQubeClient | null = null;

  constructor(options: LocalConfigOptions) {
    this.options = options;
    this.id = v4();
  }

  async connect(): Promise<void> {
    if (this.options.adoToken) {
      this.adoClient = new AzureDevOps({
        organization: this.options.ado.organization,
        project: this.options.ado.project,
      });
      await this.adoClient.connect(this.options.adoToken);
    }
    if (this.options.sonarQubeToken) {
      this.sonarQubeClient = new SonarQubeClient();
      await this.sonarQubeClient.connect(this.options.sonarQubeToken);
    }
  }

  async getRootConfig(): Promise<RootAgentConfig> {
    return this.options.config;
  }

  async getAgentConfig(agentName: string): Promise<AgentConfig> {
    const fullConfig = await this.getRootConfig();
    const defaultConfig: AgentConfig = fullConfig.defaultAgentConfig || {};
    const agentConfig = fullConfig.agents[agentName];
    if (!agentConfig) {
      throw new Error(`Agent "${agentName}" not found in local configuration.`);
    }
    return { ...defaultConfig, ...agentConfig };
  }

  async buildPrompt(promptKey: string, context?: PromptContext): Promise<string> {
    const agentConfig = await this.getAgentConfig(promptKey);
    const promptDefinition = agentConfig.prompts;
    if (!promptDefinition) {
      throw new Error(`Prompt key "${promptKey}" not found for agent.`);
    }

    const filePaths = Array.isArray(promptDefinition) ? promptDefinition : [promptDefinition];
    const resolvedContents: string[] = [];

    for (const pathTemplate of filePaths) {
      // Resolve path variables (e.g. prompts/{repo}/rule.md)
      const interpolatedPath = context?.pathVars
        ? Handlebars.compile(pathTemplate)(context.pathVars)
        : pathTemplate;

      const fullPath = path.resolve(this.options.configDir, interpolatedPath);
      const rawContent = await readFile(fullPath, "utf-8");

      // Resolve content variables (e.g. {{diff}})
      const finalContent = context?.contentVars
        ? Handlebars.compile(rawContent)(context.contentVars)
        : rawContent;

      resolvedContents.push(finalContent);
    }
    return resolvedContents.join("\n\n");
  }

  getAdoClient(): AzureDevOps {
    if (!this.adoClient) {
      throw new Error("ADO client not connected. Call connect() first.");
    }
    return this.adoClient;
  }

  getSonarQubeClient(): SonarQubeClient {
    if (!this.sonarQubeClient) {
      throw new Error("SonarQube client not connected. Call connect() first.");
    }
    return this.sonarQubeClient;
  }

  async getOrmClient(): Promise<null> {
    // ORM is not supported in local mode
    return null;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter ratan-code-review-agent exec vitest run src/cli/config/local-client.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add agents/ratan-code-review-agent/src/cli/config/local-client.ts agents/ratan-code-review-agent/src/cli/config/local-client.spec.ts agents/ratan-code-review-agent/test-fixtures/
git commit -m "feat: add LocalConfigClient for filesystem-based config"
```

---

### Task 3: Create config loader with env token resolution

**Files:**
- Create: `agents/ratan-code-review-agent/src/cli/config/loader.ts`

- [ ] **Step 1: Write the config loader**

Create `agents/ratan-code-review-agent/src/cli/config/loader.ts`:

```typescript
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  type ConfigProvider,
  type RootAgentConfig,
  createAgentConfigClient,
} from "agent-config-manager";
import { LocalConfigClient } from "./local-client";

const DEFAULT_CONFIG_DIR = ".ratan/code-review-agent";

interface RawWrapperConfig {
  mode: "local" | "ado";
  ado: {
    organization: string;
    project: string;
    token?: string;
  };
  sonarQubeToken?: string;
  databaseUrl?: string;
  config?: RootAgentConfig;
  configRepo?: string;
  configBranch?: string;
  configBasePath?: string;
}

function resolveEnvToken(value: string): string {
  const envMatch = value.match(/^env:(.+)$/);
  if (envMatch) {
    const envValue = process.env[envMatch[1]];
    if (!envValue) {
      throw new Error(
        `Environment variable "${envMatch[1]}" is not set. Check your config or set the ${envMatch[1]} environment variable.`,
      );
    }
    return envValue;
  }
  return value;
}

function resolveSecrets(raw: RawWrapperConfig): RawWrapperConfig {
  const resolved = { ...raw, ado: { ...raw.ado } };
  if (raw.ado.token) resolved.ado.token = resolveEnvToken(raw.ado.token);
  if (raw.sonarQubeToken) resolved.sonarQubeToken = resolveEnvToken(raw.sonarQubeToken);
  if (raw.databaseUrl) resolved.databaseUrl = resolveEnvToken(raw.databaseUrl);
  return resolved;
}

export interface LoadConfigResult {
  provider: ConfigProvider;
  configDir: string;
}

export async function loadConfig(
  configPath?: string,
): Promise<LoadConfigResult> {
  const configDir = configPath
    ? path.resolve(configPath)
    : path.resolve(process.cwd(), DEFAULT_CONFIG_DIR);

  const configFile = path.resolve(configDir, "config.json");

  let raw: RawWrapperConfig;
  try {
    const content = await readFile(configFile, "utf-8");
    raw = JSON.parse(content) as RawWrapperConfig;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(
        `\n  Error: No config found at ${configFile}\n` +
        `  Create one with: ratan-code-review init\n`
      );
      process.exit(1);
    }
    throw new Error(`Failed to parse ${configFile}: ${(err as Error).message}`);
  }

  if (raw.mode !== "local" && raw.mode !== "ado") {
    throw new Error(`Invalid mode "${raw.mode}" in ${configFile}. Must be "local" or "ado".`);
  }

  const resolved = resolveSecrets(raw);

  let provider: ConfigProvider;

  if (resolved.mode === "local") {
    if (!resolved.config) {
      throw new Error(
        `Missing "config" field in ${configFile}. In local mode, the config must be inline.`,
      );
    }
    provider = new LocalConfigClient({
      configDir,
      config: resolved.config,
      ado: resolved.ado,
      adoToken: resolved.ado.token,
      sonarQubeToken: resolved.sonarQubeToken,
      databaseUrl: resolved.databaseUrl,
    });
  } else {
    // ADO mode
    if (!resolved.configRepo || !resolved.configBranch) {
      throw new Error(
        `Missing "configRepo" or "configBranch" in ${configFile}. These are required in ADO mode.`,
      );
    }
    provider = await createAgentConfigClient({
      adoToken: resolved.ado.token || "",
      organization: resolved.ado.organization,
      project: resolved.ado.project,
      repoName: resolved.configRepo,
      branch: resolved.configBranch,
      basePath: resolved.configBasePath,
      sonarQubeToken: resolved.sonarQubeToken,
      ormConnectionUrl: resolved.databaseUrl,
    });
  }

  return { provider, configDir };
}
```

- [ ] **Step 3: Commit**

```bash
git add agents/ratan-code-review-agent/src/cli/config/loader.ts
git commit -m "feat: add config loader with env token resolution"
```

---

### Task 4: Adapt bootstrap session and startup for ConfigProvider

**Files:**
- Modify: `agents/ratan-code-review-agent/src/bootstrap/session.ts`
- Modify: `agents/ratan-code-review-agent/src/bootstrap/index.ts`
- Modify: `agents/ratan-code-review-agent/src/demo.ts`

- [ ] **Step 1: Update extractAgentConfig return type**

In `agents/ratan-code-review-agent/src/bootstrap/session.ts`, change the import and return type:

```typescript
import { AgentConfigSession } from "agent-config-manager";
import type { ConfigProvider } from "agent-config-manager";
import type z from "zod";
import type {
  CommonRequestContext,
  CommonRequestContextSchema,
} from "../review/types";

const agentConfigSessions = new AgentConfigSession();

export const getAgentConfigSessions = () => {
  return agentConfigSessions;
};

export const extractAgentConfig = (
  requestContext:
    | z.infer<typeof CommonRequestContextSchema>
    | CommonRequestContext,
): ConfigProvider => {
  const configSessionId =
    requestContext instanceof RequestContext
      ? requestContext.get("configSessionId")
      : requestContext.configSessionId;

  const agentConfig =
    agentConfigSessions.getAgentConfigSession(configSessionId);
  if (!agentConfig) {
    throw new Error(
      `Agent config session not found for id: ${configSessionId}`,
    );
  }

  return agentConfig.config;
};
```

Only changes: import `ConfigProvider`, add `: ConfigProvider` return type.

- [ ] **Step 2: Add registerProvider overload to startup**

In `agents/ratan-code-review-agent/src/bootstrap/index.ts`, add a second export function for CLI usage:

```typescript
import { RequestContext } from "../review/runtime";
import type { AgentConfigCreationOptions, ConfigProvider } from "agent-config-manager";
import { reviewAgents } from "../review";
import type { CommonRequestContext } from "../review/types";
import { scanPRs } from "./pr-scan";
import { getAgentConfigSessions } from "./session";

// Keep the original startup for backwards compat (demo.ts, evaluation)
export const startup = async (startupOptions: AgentConfigCreationOptions) => {
  console.log("[startup] Starting up agent ...");

  const agentConfig =
    await getAgentConfigSessions().createAgentConfigSession(startupOptions);

  await runScanLoop(agentConfig);
};

// New function for CLI — accepts a pre-created ConfigProvider
export const startScanWithProvider = async (provider: ConfigProvider) => {
  console.log("[startScanWithProvider] Starting scan with provider ...");

  const registered = getAgentConfigSessions().registerProvider(provider);

  await runScanLoop(registered);
};

async function runScanLoop(agentConfig: ConfigProvider) {
  console.log("[startup] Agent config session created:", agentConfig.id);

  const pendingPR$ = scanPRs({
    requestContext: { configSessionId: agentConfig.id },
  });

  console.log("[startup] Subscribing to pending PRs stream...");

  pendingPR$.subscribe(async ({ prId }) => {
    console.log(`[startup] Received pending PR: ${prId}`);
    const prReviewWorkflow = review-runtime.getWorkflow("prReviewWorkflow");
    const run = prReviewWorkflow.createRun();

    console.log(`[startup] Running prReviewWorkflow for PR: ${prId}`);

    const requestContext: CommonRequestContext = new RequestContext();
    requestContext.set("configSessionId", agentConfig.id);
    const result = run.stream({
      inputData: {
        prId,
      },
      requestContext: requestContext as RequestContext,
    });

    for await (const output of result.fullStream) {
      console.log("PR Review Workflow Output:", output);
    }
    console.log(`[startup] Finished processing PR: ${prId}`);
  });
}

export const startupEvaluation = async (
  startupOptions: AgentConfigCreationOptions,
) => {
  console.log("[startupEvaluation] Starting up evaluation mode...");
  const agentConfig =
    await getAgentConfigSessions().createAgentConfigSession(startupOptions);
  console.log("[startup] Agent config session created:", agentConfig.id);
  const codeReviewEvaluationJudgeAgent = review-runtime.getAgent(
    "codeReviewEvaluationJudgeAgent",
  );
  console.log("[startupEvaluation] Evaluation mode is not yet implemented.");
};
```

- [ ] **Step 3: No changes needed to demo.ts**

The demo.ts still calls `startup()` with `AgentConfigCreationOptions` — the original signature is preserved.

- [ ] **Step 4: Build to verify**

Run: `pnpm --filter ratan-code-review-agent build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add agents/ratan-code-review-agent/src/bootstrap/session.ts agents/ratan-code-review-agent/src/bootstrap/index.ts
git commit -m "refactor: adapt bootstrap to accept ConfigProvider"
```

---

### Task 5: Add repo list caching to pr-scan

**Files:**
- Modify: `agents/ratan-code-review-agent/src/bootstrap/pr-scan.ts`

- [ ] **Step 1: Add repo cache to pr-scan.ts**

In `agents/ratan-code-review-agent/src/bootstrap/pr-scan.ts`, add a module-level cache and use it:

```typescript
import { minimatch } from "minimatch";
import { Observable } from "rxjs";
import z from "zod";
import type { CommonRequestContextSchema } from "../review/types";
import { extractAgentConfig } from "./session";

const PendingPRSchema = z.object({
  repoName: z.string().optional().describe("The name of the repository"),
  prId: z.number().describe("The ID of the pull request"),
});

type PendingPR = z.infer<typeof PendingPRSchema>;

// Repo list cache: 24h TTL
const REPO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let cachedRepos: { name?: string }[] | null = null;
let lastRepoFetch = 0;

async function getCachedRepos(adoClient: { getRepos(): Promise<{ name?: string }[]> }) {
  const now = Date.now();
  if (!cachedRepos || now - lastRepoFetch > REPO_CACHE_TTL_MS) {
    console.log("[scanPRs] Fetching repo list from ADO...");
    cachedRepos = await adoClient.getRepos();
    lastRepoFetch = now;
    console.log(`[scanPRs] Cached ${cachedRepos.length} repos (24h TTL)`);
  } else {
    console.log(`[scanPRs] Using cached repo list (${cachedRepos.length} repos)`);
  }
  return cachedRepos;
}
```

Then replace `const myRepos = await adoClient.getRepos()` with:

```typescript
const myRepos = await getCachedRepos(adoClient);
```

- [ ] **Step 2: Build to verify**

Run: `pnpm --filter ratan-code-review-agent build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add agents/ratan-code-review-agent/src/bootstrap/pr-scan.ts
git commit -m "perf: add 24h cache for ADO repo list in pr-scan"
```

---

### Task 6: Create CLI entry point with commander

**Files:**
- Create: `agents/ratan-code-review-agent/src/cli/index.ts`
- Create: `agents/ratan-code-review-agent/src/cli/commands/scan.ts`
- Create: `agents/ratan-code-review-agent/src/cli/commands/studio.ts`
- Create: `agents/ratan-code-review-agent/src/cli/commands/init.ts`

- [ ] **Step 1: Create the init command**

Create `agents/ratan-code-review-agent/src/cli/commands/init.ts`:

```typescript
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_CONFIG_TEMPLATE = {
  mode: "local",
  ado: {
    organization: "your-ado-org",
    project: "your-project",
    token: "env:ADO_TOKEN",
  },
  config: {
    scanRepoNames: ["*"],
    scanPRCreatedDaysAgo: 3,
    defaultAgentConfig: {
      model: "gpt-5-mini",
    },
    agents: {
      review: { prompts: ["prompts/review/principles.md"] },
      "issue-classification": { prompts: ["prompts/review/issue-classification.md"] },
      "review-rescore": { prompts: ["prompts/review/principles.md"] },
      summary: { prompts: ["prompts/summary/instructions.md"] },
    },
  },
};

const DEFAULT_PROMPTS: Record<string, string> = {
  "prompts/review/principles.md": `# Code Review Principles

Focus on:
1. Security vulnerabilities
2. Performance issues
3. Logic errors
4. Code style consistency
5. Test coverage gaps
`,
  "prompts/review/issue-classification.md": `# Issue Classification

Classify each issue as: Critical, High, Medium, or Low severity.
`,
  "prompts/summary/instructions.md": `# Summary Instructions

Provide a concise summary of the pull request changes.
`,
};

export async function init(configDir: string) {
  const configPath = path.resolve(configDir, "config.json");

  // Check if already exists
  try {
    await import("node:fs/promises").then(fs => fs.access(configPath));
    console.error(`  Config already exists at ${configPath}`);
    console.error("  Delete it first if you want to reinitialize.");
    process.exit(1);
  } catch {
    // File doesn't exist — proceed
  }

  await mkdir(path.dirname(configPath), { recursive: true });

  await writeFile(configPath, JSON.stringify(DEFAULT_CONFIG_TEMPLATE, null, 2) + "\n");
  console.log(`  Created ${configPath}`);

  for (const [promptPath, content] of Object.entries(DEFAULT_PROMPTS)) {
    const fullPath = path.resolve(configDir, promptPath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content);
    console.log(`  Created ${path.join(configDir, promptPath)}`);
  }

  console.log("\n  Edit the config and set your ADO organization/project,");
  console.log("  then run: ratan-code-review scan\n");
}
```

- [ ] **Step 2: Create the scan command**

Create `agents/ratan-code-review-agent/src/cli/commands/scan.ts`:

```typescript
import { loadConfig } from "../config/loader";
import { startScanWithProvider } from "../../bootstrap";

export interface ScanOptions {
  config?: string;
  watch?: boolean;
}

export async function scan(options: ScanOptions) {
  const { provider } = await loadConfig(options.config);
  await provider.connect();

  if (options.watch) {
    await runWatchLoop(provider, options);
  } else {
    await startScanWithProvider(provider);
  }
}

async function runWatchLoop(
  provider: import("agent-config-manager").ConfigProvider,
  options: ScanOptions,
) {
  const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

  const runOnce = async () => {
    // Re-register provider in case the session was cleared
    const { getAgentConfigSessions } = await import("../../bootstrap/session");
    getAgentConfigSessions().registerProvider(provider);

    await startScanWithProvider(provider);
  };

  // Run immediately, then every 30 min
  await runOnce();

  setInterval(async () => {
    console.log(`[watch] Scanning again (${INTERVAL_MS / 60000}min interval)...`);
    await runOnce();
  }, INTERVAL_MS);
}
```

- [ ] **Step 3: Create the studio command**

Create `agents/ratan-code-review-agent/src/cli/commands/studio.ts`:

```typescript
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface StudioOptions {
  config?: string;
  port?: number;
}

export async function studio(options: StudioOptions) {
  // Resolve the package root to find dist/
  const packageRoot = path.resolve(__dirname, "../../../..");
  const reviewOutput = path.resolve(packageRoot, "dist/index.mjs");

  let entryPoint = reviewOutput;
  try {
    await import("node:fs/promises").then(fs => fs.access(entryPoint));
  } catch {
    console.error(
      `\n  Error: plain TypeScript review runtime output not found at ${entryPoint}\n` +
      "  The dist/ directory should be included in the installed package.\n" +
      "  Try reinstalling: npm install -g ratan-code-review\n"
    );
    process.exit(1);
  }

  const loaderFlag = path.resolve(packageRoot, "scripts/protobufjs-esm-loader.mjs");
  const instrumentationFlag = path.resolve(packageRoot, "dist/instrumentation.mjs");

  const args = [
    `--loader=${loaderFlag}`,
    `--import=${instrumentationFlag}`,
    entryPoint,
    ...(options.port ? ["--port", String(options.port)] : []),
  ];

  console.log(`Starting review dashboard...`);
  if (options.port) {
    console.log(`  Port: ${options.port}`);
  }

  const child = spawn("node", args, {
    stdio: "inherit",
    env: { ...process.env },
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}
```

- [ ] **Step 4: Create the CLI entry point**

Create `agents/ratan-code-review-agent/src/cli/index.ts`:

```typescript
#!/usr/bin/env node

import { Command } from "commander";
import path from "node:path";
import { scan } from "./commands/scan";
import { studio } from "./commands/studio";
import { init } from "./commands/init";

const packageJson = await import("../../package.json", { with: { type: "json" } });

const program = new Command();

program
  .name("ratan-code-review")
  .description("AI-powered code review agent for Azure DevOps")
  .version(packageJson.default?.version ?? packageJson.version ?? "0.0.1");

program
  .command("init")
  .description("Scaffold .ratan/code-review-agent/config.json with defaults")
  .option("--config <path>", "Config directory path")
  .action(async (opts) => {
    const configDir = opts.config
      ? path.resolve(opts.config)
      : path.resolve(process.cwd(), ".ratan/code-review-agent");
    await init(configDir);
  });

program
  .command("scan")
  .description("Scan and review pull requests")
  .option("--config <path>", "Config directory path")
  .option("--watch", "Keep running and scan every 30 minutes")
  .action(async (opts) => {
    await scan({ config: opts.config, watch: opts.watch });
  });

program
  .command("studio")
  .description("Launch review dashboard web UI")
  .option("--config <path>", "Config directory path")
  .option("--port <number>", "Port to run the studio on")
  .action(async (opts) => {
    await studio({ config: opts.config, port: opts.port ? Number(opts.port) : undefined });
  });

program.parse(process.argv);
```

- [ ] **Step 5: Build to verify CLI compiles**

Run: `pnpm --filter ratan-code-review-agent build`
Expected: Build succeeds. `dist/cli/index.js` and `dist/cli/commands/*.js` exist.

- [ ] **Step 6: Commit**

```bash
git add agents/ratan-code-review-agent/src/cli/
git commit -m "feat: add CLI entry point with scan, studio, init commands"
```

---

### Task 7: Create bin shim and update package.json

**Files:**
- Create: `agents/ratan-code-review-agent/bin/ratan-code-review.js`
- Modify: `agents/ratan-code-review-agent/package.json`
- Modify: `agents/ratan-code-review-agent/rslib.config.ts`
- Modify: `agents/ratan-code-review-agent/src/index.ts`
- Modify: `root/package.json` (optional)

- [ ] **Step 1: Create the bin shebang shim**

Create `agents/ratan-code-review-agent/bin/ratan-code-review.js`:

```javascript
#!/usr/bin/env node
import '../dist/cli/index.js';
```

- [ ] **Step 2: Update package.json**

Update `agents/ratan-code-review-agent/package.json`:

```json
{
  "name": "ratan-code-review",
  "version": "0.1.0",
  "private": false,
  "license": "ISC",
  "type": "module",
  "bin": {
    "ratan-code-review": "./bin/ratan-code-review.js"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "main": "./dist/index.cjs",
  "types": "./dist/index.d.ts",
  "files": [
    "dist",
    "bin",
    "dist"
  ],
  "scripts": {
    "dev": "tsx src/cli/index.ts start --watch",
    "demo": "cross-env NODE_TLS_REJECT_UNAUTHORIZED=0 tsx src/demo.ts",
    "test-api": "tsx src/review/agents/test-api.ts",
    "build": "NODE_OPTIONS='--max-old-space-size=4096' rslib build",
    "start": "node ./bin/ratan-code-review.cjs start",
    "codegen": "tsx ./src/evaluation/json-schema-generator.ts",
    "prepublish": "pnpm build"
  },
  "publishConfig": {
    "access": "public"
  },
  "devDependencies": {
    "@rslib/core": "^0.18.6",
    "@types/node": "^25.9.1",
    "cross-env": "^10.1.0",
    "dotenv": "^17.4.2",
    "tsx": "^4.19.0",
    "typescript": "^5.9.3",
    "vitest": "^4.0.10"
  },
  "dependencies": {
    "@ai-sdk/openai": "^3.0.65",
    "agent-config-manager": "workspace:*",
    "ai": "^6.0.191",
    "commander": "^13.0.0",
    "handlebars": "^4.7.8",
    "minimatch": "^10.1.1",
    "openai": "^6.9.0",
    "protobufjs": "^8.4.2",
    "ratan-ado-api": "workspace:*",
    "ratan-sonarqube-api": "workspace:*",
    "readable-stream": "^4.7.0",
    "redact-pii": "^3.4.0",
    "request": "^2.88.2",
    "rxjs": "7.8.2",
    "talisman": "^1.1.4",
    "zod": "^4.1.12"
  },
  "author": "Shuai,Lu (shuai.lu@sc.com)",
  "keywords": []
}
```

Key changes:
- `name` changed to `ratan-code-review`
- `private` changed to `false`
- Added `bin` field
- Added `commander` to dependencies
- Updated `files` to include `dist`
- Added `prepublish` script
- Added `publishConfig`

- [ ] **Step 3: Update rslib.config.ts**

Update `agents/ratan-code-review-agent/rslib.config.ts`:

```typescript
import { defineConfig } from "@rsliblocal review runtime";

export default defineConfig({
  lib: [
    {
      format: "esm",
      syntax: ["node 20"],
      dts: false,
    },
    {
      format: "cjs",
      syntax: ["node 20"],
    },
  ],
  output: {
    minify: false, // Better stack traces for CLI users
  },
});
```

- [ ] **Step 4: Install commander**

Run: `pnpm install`
Expected: `commander` added to lockfile.

- [ ] **Step 5: Rebuild**

Run: `pnpm build`
Expected: Build succeeds. Verify `dist/cli/index.js` exists.

- [ ] **Step 6: Commit**

```bash
git add agents/ratan-code-review-agent/bin/ agents/ratan-code-review-agent/package.json agents/ratan-code-review-agent/rslib.config.ts
git commit -m "feat: publish as ratan-code-review npm package with CLI bin"
```

---

### Task 8: Install dependencies and verify build

- [ ] **Step 1: Full clean build**

```bash
cd /root/code/github/code-review-agent
pnpm clean
pnpm install
pnpm build
```

Expected: All packages build. `dist/cli/index.js` exists in the agent package.

- [ ] **Step 2: Verify the bin shim works**

```bash
node agents/ratan-code-review-agent/bin/ratan-code-review.js --help
```

Expected: Prints help text with init, scan, studio commands.

- [ ] **Step 3: Run existing tests**

```bash
pnpm test
```

Expected: Existing tests pass (at minimum the sensitive-data-mask spec).

- [ ] **Step 4: Commit**

```bash
git add pnpm-lock.yaml
git commit -m "chore: update lockfile after adding commander dependency"
```

---

### Spec Coverage Check

| Spec Requirement | Implemented In |
|---|---|
| ConfigProvider interface | Task 1 |
| AgentConfigClient implements ConfigProvider | Task 1, Step 4 |
| AgentConfigSession stores ConfigProvider | Task 1, Step 6 |
| LocalConfigClient | Task 2 |
| Config wrapper schema | Task 3 (RawWrapperConfig) |
| Env token resolution (`"env:VAR_NAME"`) | Task 3 (`resolveEnvToken`) |
| CLI entry with commander | Task 6 |
| `init` command | Task 6, Step 1 |
| `scan` command (one-shot) | Task 6, Step 2 |
| `scan --watch` (30min interval) | Task 6, Step 2 |
| `studio` command (pre-built dist/) | Task 6, Step 3 |
| Repo list cache (24h TTL) | Task 5 |
| `startup()` backward-compat | Task 4, Step 2 |
| `startScanWithProvider()` | Task 4, Step 2 |
| `bin/` shebang shim | Task 7, Step 1 |
| Package.json changes (name, bin, files, publishConfig) | Task 7, Step 2 |
| rslib minification disabled | Task 7, Step 3 |
