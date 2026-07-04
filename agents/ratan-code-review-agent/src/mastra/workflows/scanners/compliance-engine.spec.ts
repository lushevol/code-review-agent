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
function createCodeChange(
  filePath: string,
  mLines: string[],
  startLine = 1,
  changeType = 1,
) {
  return {
    newFilePath: filePath,
    oldFilePath: filePath,
    changeType: "Edit",
    blocks: [
      {
        changeType,
        oLine: startLine,
        oLinesCount: 0,
        mLine: startLine,
        mLinesCount: mLines.length,
        oLines: [],
        mLines,
      },
    ],
    changes: mLines.join("\n"),
  };
}

/**
 * Create a minimal mock PR with a single code change entry.
 */
function createMockPR(filePath: string, mLines: string[], startLine = 1, blockChangeType = 1) {
  return {
    repoId: "repo-1",
    repoName: "test-repo",
    repoUrl: "https://dev.azure.com/org/test-repo",
    projectName: "test-project",
    pullRequestId: 42,
    latestTargetCommitId: "abc",
    latestSourceCommitId: "def",
    title: "Test PR",
    description: "Test",
    status: 0,
    authorName: "Tester",
    authorId: "tester@test.com",
    creationDate: "2024-01-01T00:00:00.000Z",
    sourceRefName: "refs/heads/feature",
    targetRefName: "refs/heads/main",
    sourceBranch: "feature",
    targetBranch: "main",
    reviewers: [],
    latestIterationId: 1,
    workItemIds: [],
    commentThreads: [],
    codeDiffs: "",
    codeDiffsArray: [createCodeChange(filePath, mLines, startLine, blockChangeType)],
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
    mastra: {},
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
    expect(todoFinding!.confidence).toBe(1.0);
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
    // Build 2 blocks each with 250 lines → 500 total
    const lines = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`);
    const pr = {
      repoId: "repo-1",
      repoName: "test-repo",
      repoUrl: "https://dev.azure.com/org/test-repo",
      projectName: "test-project",
      pullRequestId: 42,
      latestTargetCommitId: "abc",
      latestSourceCommitId: "def",
      title: "Test PR",
      description: "Test",
      status: 0,
      authorName: "Tester",
      authorId: "tester@test.com",
      creationDate: "2024-01-01T00:00:00.000Z",
      sourceRefName: "refs/heads/feature",
      targetRefName: "refs/heads/main",
      sourceBranch: "feature",
      targetBranch: "main",
      reviewers: [],
      latestIterationId: 1,
      workItemIds: [],
      commentThreads: [],
      codeDiffs: "",
      codeDiffsArray: [
        {
          newFilePath: "src/huge-file.ts",
          oldFilePath: "src/huge-file.ts",
          changeType: "Edit",
          blocks: [
            {
              changeType: 1,
              oLine: 1,
              oLinesCount: 0,
              mLine: 1,
              mLinesCount: lines.length,
              oLines: [],
              mLines: lines,
            },
            {
              changeType: 1,
              oLine: 251,
              oLinesCount: 0,
              mLine: 251,
              mLinesCount: lines.length,
              oLines: [],
              mLines: lines,
            },
          ],
          changes: lines.concat(lines).join("\n"),
        },
      ],
    };
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
    const pr = {
      repoId: "repo-1",
      repoName: "test-repo",
      repoUrl: "https://dev.azure.com/org/test-repo",
      projectName: "test-project",
      pullRequestId: 42,
      latestTargetCommitId: "abc",
      latestSourceCommitId: "def",
      title: "Test PR",
      description: "Test",
      status: 0,
      authorName: "Tester",
      authorId: "tester@test.com",
      creationDate: "2024-01-01T00:00:00.000Z",
      sourceRefName: "refs/heads/feature",
      targetRefName: "refs/heads/main",
      sourceBranch: "feature",
      targetBranch: "main",
      reviewers: [],
      latestIterationId: 1,
      workItemIds: [],
      commentThreads: [],
      codeDiffs: "",
      codeDiffsArray: [],
    };
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
    // A block with changeType 2 (Delete) should be skipped entirely
    const pr = {
      repoId: "repo-1",
      repoName: "test-repo",
      repoUrl: "https://dev.azure.com/org/test-repo",
      projectName: "test-project",
      pullRequestId: 42,
      latestTargetCommitId: "abc",
      latestSourceCommitId: "def",
      title: "Test PR",
      description: "Test",
      status: 0,
      authorName: "Tester",
      authorId: "tester@test.com",
      creationDate: "2024-01-01T00:00:00.000Z",
      sourceRefName: "refs/heads/feature",
      targetRefName: "refs/heads/main",
      sourceBranch: "feature",
      targetBranch: "main",
      reviewers: [],
      latestIterationId: 1,
      workItemIds: [],
      commentThreads: [],
      codeDiffs: "",
      codeDiffsArray: [
        {
          newFilePath: "src/deleted-file.ts",
          oldFilePath: "src/deleted-file.ts",
          changeType: "Delete",
          blocks: [
            {
              changeType: 2,
              oLine: 1,
              oLinesCount: 3,
              mLine: 0,
              mLinesCount: 0,
              oLines: [
                "// TODO: this was never finished",
                "function oldCode() {}",
              ],
              mLines: [],
            },
          ],
          changes: "",
        },
      ],
    };

    const context = createMockContext();
    const result = await complianceEngine.scan(pr, context);

    const todoFinding = result.findings.find(
      (f) => f.title && f.title.includes("TODO"),
    );
    expect(todoFinding).toBeUndefined();
  });
});
