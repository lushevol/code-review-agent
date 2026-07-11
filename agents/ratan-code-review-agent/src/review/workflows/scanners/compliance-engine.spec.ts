import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { complianceEngine } from "./compliance-engine";

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Build a single code-change entry for the PR diff array.
 *
 * @param filePath  Path of the changed file
 * @param mLines    Modified / added lines (each string is a line of code)
 * @param startLine Starting line number in the new file (default 1)
 * @param changeType 1 = Add, 2 = Delete, 3 = Edit (default 1)
 */
let currentChanges: Array<{
  path: string;
  status: "added" | "modified" | "deleted";
  addedLines: Array<{ line: number; text: string }>;
}> = [];

function createCodeChange(
  filePath: string,
  mLines: string[],
  startLine = 1,
  changeType = 1,
) {
  return {
    path: filePath,
    status: changeType === 2 ? ("deleted" as const) : ("modified" as const),
    addedLines:
      changeType === 2
        ? []
        : mLines.map((text, index) => ({ line: startLine + index, text })),
  };
}

/**
 * Create a minimal mock PR with a single code change entry.
 */
function createMockPR(filePath: string, mLines: string[], startLine = 1, blockChangeType = 1) {
  currentChanges = [createCodeChange(filePath, mLines, startLine, blockChangeType)];
  return {
    repoId: "repo-1",
    repoName: "test-repo",
    cloneUrl: "https://dev.azure.com/org/test-repo",
    sourceRepoId: "repo-1",
    sourceRepoName: "test-repo",
    sourceCloneUrl: "https://dev.azure.com/org/test-repo",
    projectName: "test-project",
    pullRequestId: 42,
    latestTargetCommitId: "abc",
    latestSourceCommitId: "def",
    title: "Test PR",
    description: "Test",
    status: 0,
    isDraft: false,
    authorName: "Tester",
    authorId: "tester@test.com",
    creationDate: "2024-01-01T00:00:00.000Z",
    sourceRefName: "refs/heads/feature",
    targetRefName: "refs/heads/main",
    sourceBranch: "feature",
    targetBranch: "main",
    reviewers: [],
  };
}

/**
 * Build a minimal ScanContext. The compliance engine reads
 * provider.getRootConfig() but gracefully handles failures.
 */
function createMockContext() {
  return {
    provider: {
      getRootConfig: vi.fn().mockResolvedValue({ scannerSettings: {} }),
    },
    adoClient: {},
    findingStore: {},
    agents: {},
    workspace: {
      repoPath: "",
      runDirectory: "",
      mergeBaseCommit: "abc",
      headCommit: "def",
      changes: currentChanges,
    },
    ocrRunner: {},
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("complianceEngine", () => {
  it("returns a finding when a changed file contains a TODO comment", async () => {
    const pr = createMockPR("src/main.ts", [
      "const x = 1;",
      "// TODO: implement error handling",
    ]);
    const context = createMockContext();

    const result = await complianceEngine.scan(pr, context);

    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    const todoFinding = result.findings.find(
      (f) => f.title && f.title.includes("TODO"),
    );
    expect(todoFinding).toBeDefined();
    expect(todoFinding!.severity).toBe("low");
    expect(todoFinding!.category).toBe("compliance");
    expect(todoFinding!.confidence).toBeUndefined();
  });

  it("loads YAML compliance rules from the configured rules path", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "ratan-rules-"));
    try {
      const rulesDir = path.join(baseDir, ".ratan", "code-review-agent", "rules");
      await mkdir(rulesDir, { recursive: true });
      await writeFile(
        path.join(rulesDir, "forbidden.yaml"),
        [
          "rule-id: no-dangerous-call",
          "description: Dangerous calls are not allowed",
          "severity: high",
          "forbidden_patterns:",
          "  - dangerousCall(",
          "file_patterns:",
          "  - '**/*.ts'",
          "",
        ].join("\n"),
        "utf-8",
      );

      const pr = createMockPR("src/main.ts", ["dangerousCall(userInput);"]);
      const context = {
        ...createMockContext(),
        provider: {
          getRootConfig: vi.fn().mockResolvedValue({
            scannerSettings: {
              compliance: {
                rulesPath: baseDir,
              },
            },
          }),
        },
      };

      const result = await complianceEngine.scan(pr, context);

      const yamlFinding = result.findings.find(
        (finding) => finding.title === "Compliance rule: no-dangerous-call",
      );
      expect(yamlFinding).toBeDefined();
      expect(yamlFinding!.severity).toBe("high");
      expect(yamlFinding!.blocking).toBe(true);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("returns a finding when a changed file contains a FIXME comment", async () => {
    const pr = createMockPR("src/services/user.ts", [
      'const user = await db.findUser(id);',
      '// FIXME: this query is N+1',
    ]);
    const context = createMockContext();

    const result = await complianceEngine.scan(pr, context);

    const fixmeFinding = result.findings.find(
      (f) => f.title && f.title.includes("FIXME"),
    );
    expect(fixmeFinding).toBeDefined();
  });

  it("returns a finding when a changed file contains a HACK comment", async () => {
    const pr = createMockPR("src/utils.ts", [
      '// HACK: work around API rate limiting',
      'await sleep(1000);',
    ]);
    const context = createMockContext();

    const result = await complianceEngine.scan(pr, context);

    const hackFinding = result.findings.find(
      (f) => f.title && f.title.includes("HACK"),
    );
    expect(hackFinding).toBeDefined();
  });

  it("returns a finding when a changed file contains an XXX comment", async () => {
    const pr = createMockPR("src/config.ts", [
      'const apiKey = "default";',
      '// XXX: replace with real API key',
    ]);
    const context = createMockContext();

    const result = await complianceEngine.scan(pr, context);

    const xxxFinding = result.findings.find(
      (f) => f.title && f.title.includes("XXX"),
    );
    expect(xxxFinding).toBeDefined();
  });

  it("returns a finding when a file has more than 400 changed lines", async () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`);
    const pr = createMockPR("src/huge-file.ts", lines);
    const context = createMockContext();

    const result = await complianceEngine.scan(pr, context);

    const largeFileFinding = result.findings.find(
      (f) => f.title && f.title.startsWith("Large file change"),
    );
    expect(largeFileFinding).toBeDefined();
    expect(largeFileFinding!.severity).toBe("informational");
  });

  it("returns a finding for console.log in a source file", async () => {
    const pr = createMockPR("src/app.ts", [
      'const name = "World";',
      'console.log("Hello, " + name);',
    ]);
    const context = createMockContext();

    const result = await complianceEngine.scan(pr, context);

    const consoleFinding = result.findings.find(
      (f) => f.title && f.title.includes("Console"),
    );
    expect(consoleFinding).toBeDefined();
    expect(consoleFinding!.severity).toBe("low");
  });

  it("returns a finding for console.error in a source file", async () => {
    const pr = createMockPR("src/api/handler.ts", [
      'try {',
      '  await process();',
      '} catch (err) {',
      '  console.error("Processing failed", err);',
      '}',
    ]);
    const context = createMockContext();

    const result = await complianceEngine.scan(pr, context);

    const consoleFinding = result.findings.find(
      (f) => f.title && f.title.includes("Console"),
    );
    expect(consoleFinding).toBeDefined();
  });

  it("returns no findings for clean code", async () => {
    const pr = createMockPR("src/clean.ts", [
      'export function add(a: number, b: number): number {',
      '  return a + b;',
      '}',
    ]);
    const context = createMockContext();

    const result = await complianceEngine.scan(pr, context);

    expect(result.findings).toEqual([]);
  });

  it("returns no findings when the PR has no code diffs", async () => {
    const pr = createMockPR("src/empty.ts", []);
    currentChanges = [];
    const context = createMockContext();

    const result = await complianceEngine.scan(pr, context);

    expect(result.findings).toEqual([]);
  });

  it("does not flag console.log in test files", async () => {
    // Use a path matching the "**/__tests__/**" test file pattern via minimatch
    const pr = createMockPR("src/__tests__/helper.ts", [
      'describe("my test", () => {',
      '  it("works", () => {',
      '    console.log("debug");',
      '    expect(1).toBe(1);',
      '  });',
      '});',
    ]);
    const context = createMockContext();

    const result = await complianceEngine.scan(pr, context);

    const consoleFinding = result.findings.find(
      (f) => f.title && f.title.includes("Console"),
    );
    expect(consoleFinding).toBeUndefined();
  });

  it("does not flag console.log in __tests__ directories", async () => {
    const pr = createMockPR("src/__tests__/helper.test-utils.ts", [
      'console.log("test setup done");',
    ]);
    const context = createMockContext();

    const result = await complianceEngine.scan(pr, context);

    const consoleFinding = result.findings.find(
      (f) => f.title && f.title.includes("Console"),
    );
    expect(consoleFinding).toBeUndefined();
  });

  it("still flags TODO markers in test files (no test-file guard on TODO check)", async () => {
    const pr = createMockPR("src/foo.spec.ts", [
      '// TODO: add edge case for empty input',
      'it("handles empty input", () => {',
      '  expect(handler("")).toBe(undefined);',
      '});',
    ]);
    const context = createMockContext();

    const result = await complianceEngine.scan(pr, context);

    const todoFinding = result.findings.find(
      (f) => f.title && f.title.includes("TODO"),
    );
    expect(todoFinding).toBeDefined();
  });

  it("returns engine field as 'compliance'", async () => {
    const pr = createMockPR("src/file.ts", [
      '// TODO: clean this up',
    ]);
    const context = createMockContext();

    const result = await complianceEngine.scan(pr, context);

    expect(result.engine).toBe("compliance");
    if (result.findings.length > 0) {
      expect(result.findings[0].sourceEngine).toBe("compliance");
    }
  });

  it("ignores deleted-only blocks (changeType === 2)", async () => {
    const pr = createMockPR(
      "src/deleted-file.ts",
      ["// TODO: this was never finished", "function oldCode() {}"],
      1,
      2,
    );

    const context = createMockContext();
    const result = await complianceEngine.scan(pr, context);

    const todoFinding = result.findings.find(
      (f) => f.title && f.title.includes("TODO"),
    );
    expect(todoFinding).toBeUndefined();
  });
});
