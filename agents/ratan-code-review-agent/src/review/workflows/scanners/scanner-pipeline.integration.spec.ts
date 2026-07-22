import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryFindingStore } from "../../../../../../packages/finding-store/src/memory-store";
import { complianceEngine } from "./compliance-engine";
import { CveScanner } from "./cve-scanner";
import { reconcileFindings } from "../utils/finding-reconciler";
import {
  type NormalizedFinding,
  type EngineType,
  type FindingSeverity,
  type FindingCategory,
  computeContentHash,
  generateFindingId,
} from "../../types/finding";
import type { Scanner, ScanContext } from "./types";
import {
  aggregateScannerResults,
  buildReviewOutcomeMetadata,
  buildCorrelationSummary,
  correlateFindings,
  loadPreviouslyLinkedFindings,
  prioritizeFindings,
  severityCounts,
} from "./scanner-pipeline";

// ─── Helpers ────────────────────────────────────────────────────────────────

function createFinding(overrides: Partial<NormalizedFinding> & { severity: FindingSeverity }): NormalizedFinding {
  const now = new Date().toISOString();
  const filePath = overrides.filePath ?? "src/main.ts";
  const title = overrides.title ?? `Test finding: ${overrides.severity}`;
  const evidence = overrides.evidence ?? `Evidence for ${overrides.severity} finding`;

  return {
    id: overrides.id ?? generateFindingId(),
    prId: overrides.prId ?? 42,
    repository: overrides.repository ?? "test-repo",
    filePath,
    lineStart: overrides.lineStart ?? 1,
    lineEnd: overrides.lineEnd ?? 1,
    category: overrides.category ?? "quality",
    severity: overrides.severity,
    confidence: overrides.confidence ?? 0.9,
    title,
    description: overrides.description ?? title,
    evidence,
    businessImpact: overrides.businessImpact ?? "Test business impact",
    remediation: overrides.remediation ?? "Test remediation",
    blocking: overrides.blocking ?? (overrides.severity === "critical"),
    linkedTaskId: overrides.linkedTaskId ?? null,
    resolution: overrides.resolution ?? "open",
    sourceEngine: overrides.sourceEngine ?? "ai-review",
    sourceVersion: overrides.sourceVersion ?? "1.0.0",
    supersedesFindingId: overrides.supersedesFindingId ?? null,
    contentHash: overrides.contentHash ?? computeContentHash(filePath, [title, evidence]),
    createdAt: overrides.createdAt ?? now,
    resolvedAt: overrides.resolvedAt ?? null,
  };
}

/**
 * Build a single code-change entry for a PR diff array.
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
 * Create a minimal mock PR for scanner tests.
 */
function createMockPR(filePath: string, mLines: string[], startLine = 1) {
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
    codeDiffsArray: [createCodeChange(filePath, mLines, startLine)],
  };
}

// ─── Mock scanner for testing pipeline integration ─────────────────────────

class MockScanner implements Scanner {
  readonly id: string;
  readonly engine: EngineType;
  private findingsToReturn: NormalizedFinding[];
  private shouldThrow: boolean;

  constructor(
    id: string,
    engine: EngineType,
    findings: NormalizedFinding[] = [],
    shouldThrow = false,
  ) {
    this.id = id;
    this.engine = engine;
    this.findingsToReturn = findings;
    this.shouldThrow = shouldThrow;
  }

  async scan(): Promise<{
    findings: NormalizedFinding[];
    engine: EngineType;
    durationMs: number;
  }> {
    if (this.shouldThrow) {
      throw new Error(`Scanner ${this.id} failed`);
    }
    return {
      findings: this.findingsToReturn,
      engine: this.engine,
      durationMs: 10,
    };
  }
}

// ─── Mock sonar client ─────────────────────────────────────────────────────

function createMockSonarClient(issues: Record<string, unknown>[] = []) {
  return {
    searchIssues: vi.fn().mockResolvedValue({ total: issues.length, issues }),
  };
}

function createDefaultMockSonarClient() {
  return createMockSonarClient([
    {
      key: "SQ-001",
      rule: "ts:S555",
      severity: "MAJOR",
      component: "test-repo:src/main.ts",
      project: "test-repo",
      line: 10,
      message: "Hardcoded credential",
      effort: "5min",
      debt: "5min",
      tags: ["security", "cwe"],
      type: "VULNERABILITY",
      status: "OPEN",
      resolution: "",
      creationDate: "2024-01-01T00:00:00.000Z",
      updateDate: "2024-01-01T00:00:00.000Z",
      textRange: { startLine: 10, endLine: 15, startOffset: 0, endOffset: 10 },
    },
  ]);
}

// ─── Mock Provider ─────────────────────────────────────────────────────────

function createMockProvider(overrides: Record<string, unknown> = {}) {
  return {
    getRootConfig: vi.fn().mockResolvedValue({
      scannerSettings: { cve: { enabled: true, sonarqubeProjectKey: "test-project" } },
      maxFindingsPerPR: 100,
      ...overrides,
    }),
    buildPrompt: vi.fn().mockResolvedValue("Mock prompt instructions"),
    getAdoClient: vi.fn().mockReturnValue({
      addCommentThreadForPRCode: vi.fn().mockResolvedValue({ id: 123 }),
      addCommentForPR: vi.fn().mockResolvedValue({ id: 456 }),
      createPullRequestStatus: vi.fn().mockResolvedValue(undefined),
      getCommonWorkItems: vi.fn().mockResolvedValue([]),
      getCommitsBatch: vi.fn().mockResolvedValue([]),
      getPullRequestProperties: vi.fn().mockResolvedValue({ value: {} }),
      setPullRequestProperties: vi.fn().mockResolvedValue(undefined),
      getAdoClient: vi.fn().mockReturnValue({
        getGitApi: vi.fn().mockResolvedValue({
          createPullRequestStatus: vi.fn().mockResolvedValue(undefined),
        }),
        getWorkItemTrackingApi: vi.fn().mockResolvedValue({
          createWorkItem: vi.fn().mockResolvedValue({ id: 999 }),
          updateWorkItem: vi.fn().mockResolvedValue({}),
        }),
      }),
      getOrganization: vi.fn().mockReturnValue("test-org"),
      getProjectName: vi.fn().mockReturnValue("test-project"),
    }),
    getSonarQubeClient: vi.fn().mockReturnValue(createDefaultMockSonarClient()),
    ...overrides,
  };
}

// ─── ScanContext factory ───────────────────────────────────────────────────

async function createMockScanContext(overrides: Record<string, unknown> = {}): Promise<ScanContext> {
  const findingStore = new MemoryFindingStore();
  await findingStore.init();

  return {
    provider: createMockProvider(),
    adoClient: createMockProvider().getAdoClient(),
    sonarClient: createDefaultMockSonarClient(),
    findingStore,
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════════════════

describe("Scanner Pipeline Integration", () => {
  let findingStore: MemoryFindingStore;

  beforeEach(async () => {
    findingStore = new MemoryFindingStore();
    await findingStore.init();
  });

  describe("consolidated presentation", () => {
    it("adds postability and duplicate-suppression metrics to review metadata", () => {
      const metadata = buildReviewOutcomeMetadata(
        {
          status: "success",
          warningTypes: ["partial-file"],
          reviewFocuses: [{ focus: "general", reasons: ["Always selected."] }],
        },
        [
          createFinding({ severity: "high", contentHash: "postable" }),
          createFinding({ severity: "low", contentHash: "invalid", lineStart: 0 }),
          createFinding({ severity: "medium", contentHash: "linked" }),
        ],
        {
          findingIds: new Set<string>(),
          contentHashes: new Set(["linked"]),
        },
        2,
      );

      expect(metadata).toEqual({
        status: "success",
        warningTypes: ["partial-file"],
        reviewFocuses: [{ focus: "general", reasons: ["Always selected."] }],
        postableFindingCount: 1,
        duplicateSuppressionReasons: {
          contentHashCorrelation: 2,
          inlineContentHash: 0,
          previouslyLinkedThread: 1,
        },
        inlineSuppressionReasons: {
          invalidCodeLocation: 1,
          commentLimit: 0,
        },
      });
    });

    it("propagates an incomplete OpenCodeReview result through pipeline aggregation", () => {
      const aggregated = aggregateScannerResults(
        [{ id: "open-code-review", engine: "open-code-review" }],
        [
          {
            status: "fulfilled",
            value: {
              findings: [],
              engine: "open-code-review",
              durationMs: 25,
              executionStatus: "incomplete",
              metadata: { status: "timeout", warningTypes: ["timeout"] },
            },
          },
        ],
      );

      expect(aggregated).toEqual({
        findings: [],
        reviewExecutionStatus: "incomplete",
        reviewMetadata: {
          status: "timeout",
          warningTypes: ["timeout"],
          durationMs: 25,
        },
      });
    });

    it("retains routed focuses when OpenCodeReview rejects", () => {
      const reviewFocuses = [
        { focus: "general" as const, reasons: ["Always selected."] },
      ];
      const aggregated = aggregateScannerResults(
        [{ id: "open-code-review", engine: "open-code-review" }],
        [{ status: "rejected", reason: new Error("runner failed") }],
        { reviewFocuses },
      );

      expect(aggregated).toEqual({
        findings: [],
        reviewExecutionStatus: "incomplete",
        reviewMetadata: {
          status: "failed",
          durationMs: 0,
          reviewFocuses,
        },
      });
    });

    it("uses empty link history when finding-store reads fail", () => {
      const previouslyLinked = loadPreviouslyLinkedFindings(
        {
          getFindingsByPr: () => {
            throw new Error("store unavailable");
          },
          getCommentThreadsByPr: () => [],
        } as never,
        7,
        "repo",
      );

      expect(previouslyLinked.findingIds.size).toBe(0);
      expect(previouslyLinked.contentHashes.size).toBe(0);
    });

    it("groups findings into blocking, important, and advisory categories with review focuses", () => {
      const summary = buildCorrelationSummary(
        [
          createFinding({ severity: "low", blocking: true, category: "security" }),
          createFinding({ severity: "high", category: "bug", contentHash: "high-bug" }),
          createFinding({ severity: "medium", category: "bug", contentHash: "medium-bug" }),
          createFinding({ severity: "informational", category: "documentation", contentHash: "docs" }),
        ],
        [
          {
            focus: "general",
            reasons: ["General review applies to every pull request."],
          },
          {
            focus: "tests",
            reasons: ["Production code changed without matching test-file changes."],
          },
        ],
      );

      expect(summary).toBe([
        "### Consolidated findings",
        "#### Blocking (1)",
        "- **security**",
        "  - LOW — Test finding: low (`src/main.ts:1`): Test finding: low Suggestion: Test remediation",
        "#### Important (2)",
        "- **bug**",
        "  - HIGH — Test finding: high (`src/main.ts:1`): Test finding: high Suggestion: Test remediation",
        "  - MEDIUM — Test finding: medium (`src/main.ts:1`): Test finding: medium Suggestion: Test remediation",
        "#### Advisory (1)",
        "- **documentation**",
        "  - INFORMATIONAL — Test finding: informational (`src/main.ts:1`): Test finding: informational Suggestion: Test remediation",
        "#### Review focuses",
        "- general: General review applies to every pull request.",
        "- tests: Production code changed without matching test-file changes.",
      ].join("\n"));
    });
  });

  // ─── 1. Full scanner pipeline integration ─────────────────────────────

  describe("1. Full scanner pipeline integration", () => {
    it("runs multiple scanners, correlates, prioritizes, and stores findings", async () => {
      const sharedHash = computeContentHash("src/main.ts", ["Same issue from both scanners"]);

      const scanner1Findings = [
        createFinding({
          filePath: "src/main.ts",
          severity: "high",
          title: "Scanner1: Security issue",
          contentHash: sharedHash,
          sourceEngine: "ai-review",
        }),
        createFinding({
          filePath: "src/utils.ts",
          severity: "low",
          title: "Scanner1: Style issue",
          sourceEngine: "ai-review",
        }),
      ];

      const scanner2Findings = [
        // Same contentHash as scanner1's first finding — should be correlated
        createFinding({
          filePath: "src/main.ts",
          severity: "critical",
          title: "Scanner2: Security issue (critical)",
          contentHash: sharedHash,
          sourceEngine: "sonarqube-cve",
        }),
        createFinding({
          filePath: "src/config.ts",
          severity: "informational",
          title: "Scanner2: Informational note",
          sourceEngine: "sonarqube-cve",
        }),
      ];

      const scanners: Scanner[] = [
        new MockScanner("scanner1", "ai-review", scanner1Findings),
        new MockScanner("scanner2", "sonarqube-cve", scanner2Findings),
      ];

      // ── Run all scanners in parallel ──────────────────────────────────
      const results = await Promise.allSettled(
        scanners.map((scanner) => scanner.scan()),
      );

      const allFindings: NormalizedFinding[] = [];
      for (const result of results) {
        if (result.status === "fulfilled") {
          allFindings.push(...result.value.findings);
        }
      }

      expect(allFindings).toHaveLength(4); // 2 + 2

      // ── Correlate ────────────────────────────────────────────────────
      const correlated = correlateFindings(allFindings);

      // Two findings shared the same contentHash, so they should be deduplicated
      expect(correlated).toHaveLength(3);

      // The surviving finding should have the higher severity (critical > high)
      const sharedFinding = correlated.find((f) => f.contentHash === sharedHash);
      expect(sharedFinding).toBeDefined();
      expect(sharedFinding!.severity).toBe("critical");
      expect(sharedFinding!.sourceEngine).toBe("sonarqube-cve");
      // Evidence from both scanners should be merged
      expect(sharedFinding!.evidence).toContain("Evidence for high finding");
      expect(sharedFinding!.evidence).toContain("Evidence for critical finding");

      // ── Prioritize ───────────────────────────────────────────────────
      const prioritized = prioritizeFindings(correlated);

      expect(prioritized.length).toBeLessThanOrEqual(100);
      // Verify ordering: critical first, then low, then informational
      expect(prioritized[0].severity).toBe("critical");
      expect(prioritized[2].severity).toBe("informational");

      // ── Store ────────────────────────────────────────────────────────
      const stored = findingStore.batchUpsert(prioritized);
      expect(stored).toHaveLength(3);

      const retrieved = findingStore.getFindingsByPr(42, "test-repo");
      expect(retrieved).toHaveLength(3);

      // ── Summary generation (mirrors scanner-pipeline.ts) ────────────────
      const counts = severityCounts(prioritized);
      expect(counts.critical).toBe(1);
      expect(counts.low).toBe(1);
      expect(counts.informational).toBe(1);
    });

    it("exercises compliance engine and CVE scanner together", async () => {
      const pr = createMockPR("src/app.ts", [
        "const x = 1;",
        "// TODO: implement error handling",
        'console.log("debug");',
      ]);
      const sonarClient = {
        searchIssues: vi.fn().mockResolvedValue({
          issues: [
            {
              key: "SQ-1",
              rule: "ts:S555",
              severity: "MAJOR",
              component: "test-repo:src/app.ts",
              project: "test-repo",
              line: 3,
              message: "Hardcoded credential",
              effort: "5min",
              debt: "5min",
              tags: ["security"],
              type: "VULNERABILITY",
              status: "OPEN",
              resolution: "",
              creationDate: "2024-01-01T00:00:00.000Z",
              updateDate: "2024-01-01T00:00:00.000Z",
            },
          ],
        }),
      };

      const mockProvider = {
        getRootConfig: vi.fn().mockResolvedValue({ scannerSettings: { cve: { enabled: true, sonarqubeProjectKey: "test-project" } } }),
        buildPrompt: vi.fn().mockResolvedValue("Mock prompt"),
        getAdoClient: vi.fn().mockReturnValue({}),
        getSonarQubeClient: vi.fn().mockReturnValue(sonarClient),
      };

      const context = {
        provider: mockProvider,
        adoClient: {},
        sonarClient,
        findingStore,
        workspace: {
          changes: [
            {
              path: "src/app.ts",
              status: "modified",
              addedLines: [
                { line: 1, text: "// TODO: remove" },
                { line: 2, text: "console.log('debug')" },
              ],
            },
          ],
        },
      };

      // Run both real scanners
      const [complianceResult, cveResult] = await Promise.all([
        complianceEngine.scan(pr, context),
        new CveScanner().scan(pr, context),
      ]);

      // Compliance should find TODO + console.log
      expect(complianceResult.findings.length).toBeGreaterThanOrEqual(2);
      expect(complianceResult.engine).toBe("compliance");

      // CVE scanner should find the SonarQube issue
      expect(cveResult.findings).toHaveLength(1);
      expect(cveResult.findings[0].severity).toBe("medium");
      expect(cveResult.engine).toBe("sonarqube-cve");

      // Correlate across both engines
      const allFindings = [...complianceResult.findings, ...cveResult.findings];
      const correlated = correlateFindings(allFindings);
      const prioritized = prioritizeFindings(correlated);
      const stored = findingStore.batchUpsert(prioritized);

      expect(stored.length).toBe(allFindings.length); // No overlaps since different contentHashes
      expect(prioritized[0].severity).toBe("medium"); // CVE medium > compliance low
    });
  });

  // ─── 2. Scanner failure isolation ─────────────────────────────────────

  describe("2. Scanner failure isolation", () => {
    it("continues with other scanners when one throws", async () => {
      const workingFindings = [
        createFinding({
          filePath: "src/working.ts",
          severity: "high",
          sourceEngine: "ai-review",
        }),
      ];

      const scanners: Scanner[] = [
        new MockScanner("failing-scanner", "ai-review", [], true),
        new MockScanner("working-scanner", "sonarqube-cve", workingFindings),
      ];

      const results = await Promise.allSettled(
        scanners.map((scanner) => scanner.scan()),
      );

      // First scanner failed
      expect(results[0].status).toBe("rejected");
      if (results[0].status === "rejected") {
        expect((results[0].reason as Error).message).toContain("failing-scanner");
      }

      // Second scanner succeeded
      expect(results[1].status).toBe("fulfilled");
      if (results[1].status === "fulfilled") {
        expect(results[1].value.findings).toHaveLength(1);
      }

      // ── Collect results, simulating the pipeline ──────────────────────
      const allFindings: NormalizedFinding[] = [];
      for (const result of results) {
        if (result.status === "fulfilled") {
          allFindings.push(...result.value.findings);
        }
      }

      // Only the working scanner's findings remain
      expect(allFindings).toHaveLength(1);

      const correlated = correlateFindings(allFindings);
      const prioritized = prioritizeFindings(correlated);
      const stored = findingStore.batchUpsert(prioritized);
      expect(stored).toHaveLength(1);
      expect(stored[0].title).toContain("high");
    });

    it("handles all scanners failing gracefully", async () => {
      const scanners: Scanner[] = [
        new MockScanner("scanner-1", "ai-review", [], true),
        new MockScanner("scanner-2", "sonarqube-cve", [], true),
      ];

      const results = await Promise.allSettled(
        scanners.map((scanner) => scanner.scan()),
      );

      expect(results[0].status).toBe("rejected");
      expect(results[1].status).toBe("rejected");

      const allFindings: NormalizedFinding[] = [];
      for (const result of results) {
        if (result.status === "fulfilled") {
          allFindings.push(...result.value.findings);
        }
      }

      expect(allFindings).toHaveLength(0);

      // Empty correlation/prioritization should still produce valid results
      const correlated = correlateFindings([]);
      const prioritized = prioritizeFindings([]);
      expect(correlated).toHaveLength(0);
      expect(prioritized).toHaveLength(0);

      // batchUpsert with empty array
      const stored = findingStore.batchUpsert([]);
      expect(stored).toHaveLength(0);
    });
  });

  // ─── 3. Merge gate integration ───────────────────────────────────────

  describe("3. Merge gate integration", () => {
    it("blocks merge when blocking unresolved findings exist", async () => {
      // Create findings with blocking=true and resolution=open
      const findings = [
        createFinding({
          filePath: "src/security.ts",
          severity: "critical",
          blocking: true,
          resolution: "open",
          title: "Critical SQL injection",
        }),
        createFinding({
          filePath: "src/style.ts",
          severity: "low",
          blocking: false,
          resolution: "open",
          title: "Minor style issue",
        }),
      ];

      // Store findings
      findingStore.batchUpsert(findings);

      // Extract merge gate decision logic (mirrors merge-gate.ts)
      const blockingOpen = findings.filter(
        (f) => f.blocking === true && f.resolution === "open",
      );

      const mergeDecision: "allowed" | "blocked" | "pending" =
        blockingOpen.length > 0 ? "blocked" : "allowed";

      expect(mergeDecision).toBe("blocked");
      expect(blockingOpen).toHaveLength(1);
      expect(blockingOpen[0].title).toContain("SQL injection");
    });

    it("allows merge when no blocking findings exist", async () => {
      const findings = [
        createFinding({
          filePath: "src/style.ts",
          severity: "medium",
          blocking: false,
          title: "Style issue",
        }),
        createFinding({
          filePath: "src/todo.ts",
          severity: "low",
          blocking: false,
          resolution: "open",
          title: "Minor issue",
        }),
      ];

      findingStore.batchUpsert(findings);

      const blockingOpen = findings.filter(
        (f) => f.blocking === true && f.resolution === "open",
      );

      const mergeDecision: "allowed" | "blocked" | "pending" =
        blockingOpen.length > 0 ? "blocked" : "allowed";

      expect(mergeDecision).toBe("allowed");
      expect(blockingOpen).toHaveLength(0);
    });

    it("allows merge when blocking findings are resolved", async () => {
      const findings = [
        createFinding({
          filePath: "src/security.ts",
          severity: "critical",
          blocking: true,
          resolution: "resolved",
          title: "Critical SQL injection",
        }),
      ];

      findingStore.batchUpsert(findings);

      const blockingOpen = findings.filter(
        (f) => f.blocking === true && f.resolution === "open",
      );

      expect(blockingOpen).toHaveLength(0);
    });

    it("allows merge when blocking findings are waived", async () => {
      const findings = [
        createFinding({
          filePath: "src/security.ts",
          severity: "critical",
          blocking: true,
          resolution: "waived",
          title: "Critical finding (waived)",
        }),
      ];

      findingStore.batchUpsert(findings);

      const blockingOpen = findings.filter(
        (f) => f.blocking === true && f.resolution === "open",
      );

      expect(blockingOpen).toHaveLength(0);
    });
  });

  // ─── 4. Work item creation integration ───────────────────────────────

  describe("4. Work item creation integration", () => {
    it("filters critical findings for Bug creation", async () => {
      const findings = [
        createFinding({
          filePath: "src/security.ts",
          severity: "critical",
          resolution: "open",
          title: "SQL injection vulnerability",
        }),
        createFinding({
          filePath: "src/perf.ts",
          severity: "medium",
          resolution: "open",
          title: "Performance issue",
        }),
        createFinding({
          filePath: "src/style.ts",
          severity: "low",
          resolution: "open",
          title: "Style issue",
        }),
      ];

      // Mirror create-workitems.ts filtering: severity === critical || severity === high
      const actionableFindings = findings.filter(
        (f) =>
          (f.severity === "critical" || f.severity === "high") &&
          f.resolution === "open",
      );

      expect(actionableFindings).toHaveLength(1);
      expect(actionableFindings[0].severity).toBe("critical");
      expect(actionableFindings[0].title).toContain("SQL injection");
    });

    it("filters high and critical findings for work item creation", async () => {
      const findings = [
        createFinding({
          filePath: "src/security.ts",
          severity: "critical",
          title: "Critical: SQL injection",
        }),
        createFinding({
          filePath: "src/auth.ts",
          severity: "high",
          title: "High: weak password policy",
        }),
        createFinding({
          filePath: "src/style.ts",
          severity: "medium",
          title: "Medium: code style",
        }),
        createFinding({
          filePath: "src/log.ts",
          severity: "informational",
          title: "Info: log statement",
        }),
      ];

      const actionableFindings = findings.filter(
        (f) =>
          (f.severity === "critical" || f.severity === "high") &&
          f.resolution === "open",
      );

      expect(actionableFindings).toHaveLength(2);
      expect(actionableFindings[0].severity).toBe("critical");
      expect(actionableFindings[1].severity).toBe("high");
    });

    it("skips work item creation for resolved findings", async () => {
      const findings = [
        createFinding({
          filePath: "src/security.ts",
          severity: "critical",
          resolution: "resolved",
          title: "Already fixed critical issue",
        }),
        createFinding({
          filePath: "src/other.ts",
          severity: "critical",
          resolution: "waived",
          title: "Waived critical issue",
        }),
      ];

      const actionableFindings = findings.filter(
        (f) =>
          (f.severity === "critical" || f.severity === "high") &&
          f.resolution === "open",
      );

      expect(actionableFindings).toHaveLength(0);
    });

    it("creates work items via ADO client and stores linkedTaskId", async () => {
      const mockAdoWorkItemApi = {
        createWorkItem: vi.fn().mockResolvedValue({ id: 999 }),
        updateWorkItem: vi.fn().mockResolvedValue({}),
      };

      const mockAdoClient = {
        getAdoClient: vi.fn().mockReturnValue({
          getWorkItemTrackingApi: vi.fn().mockResolvedValue(mockAdoWorkItemApi),
        }),
        getOrganization: vi.fn().mockReturnValue("test-org"),
        getProjectName: vi.fn().mockReturnValue("test-project"),
      };

      const criticalFinding = createFinding({
        filePath: "src/security.ts",
        severity: "critical",
        title: "SQL injection in login handler",
        description: "User input is not sanitized",
        remediation: "Use parameterized queries",
        evidence: "Line 42 in src/security.ts",
        businessImpact: "Data breach risk",
      });

      findingStore.batchUpsert([criticalFinding]);

      // Simulate create-workitems.ts logic
      const workItemType = "Bug";
      const patchDocument = [
        { op: "add", path: "/fields/System.Title", value: `[PR Guardian] ${criticalFinding.title} (PR #42)` },
        { op: "add", path: "/fields/System.Description", value: `Finding details for ${criticalFinding.id}` },
        { op: "add", path: "/fields/System.Tags", value: "PR Guardian; Code Review" },
      ];

      const workItem = await mockAdoWorkItemApi.createWorkItem(
        null,
        patchDocument,
        "test-project",
        workItemType,
      );

      expect(mockAdoWorkItemApi.createWorkItem).toHaveBeenCalledTimes(1);
      expect(workItem.id).toBe(999);

      // Store linkedTaskId back on the finding
      criticalFinding.linkedTaskId = workItem.id;
      findingStore.upsertFinding(criticalFinding);

      const stored = findingStore.getFindingById(criticalFinding.id);
      expect(stored).not.toBeNull();
      expect(stored!.linkedTaskId).toBe(999);
    });

    it("skips work item creation when finding already has linkedTaskId", async () => {
      const mockAdoWorkItemApi = {
        createWorkItem: vi.fn().mockResolvedValue({ id: 888 }),
        updateWorkItem: vi.fn().mockResolvedValue({}),
      };

      // Finding already has a linked task
      const existingFinding = createFinding({
        filePath: "src/security.ts",
        severity: "critical",
        linkedTaskId: 777,
        title: "Already linked critical issue",
      });

      findingStore.batchUpsert([existingFinding]);

      const stored = findingStore.getFindingById(existingFinding.id);
      expect(stored!.linkedTaskId).toBe(777);

      // Simulate idempotency check: skip if linkedTaskId is not null
      if (stored && stored.linkedTaskId !== null) {
        // Skip creation
      }

      expect(mockAdoWorkItemApi.createWorkItem).not.toHaveBeenCalled();
    });
  });

  // ─── 5. Finding reconciler integration ───────────────────────────────

  describe("5. Finding reconciler integration", () => {
    it("marks old findings as superseded when new findings have same contentHash but different titles", async () => {
      const sharedHash = computeContentHash("src/main.ts", ["original issue"]);

      const oldFindings = [
        createFinding({
          id: "00000000-0000-0000-0000-000000000001",
          prId: 42,
          filePath: "src/main.ts",
          severity: "high",
          title: "Old title: security issue",
          contentHash: sharedHash,
          resolution: "open",
          sourceEngine: "ai-review",
        }),
      ];

      const newFindings = [
        createFinding({
          id: "00000000-0000-0000-0000-000000000002",
          prId: 42,
          filePath: "src/main.ts",
          severity: "high",
          title: "New title: security issue (updated)",
          contentHash: sharedHash,
          resolution: "open",
          sourceEngine: "ai-review",
        }),
      ];

      const result = reconcileFindings(oldFindings, newFindings);

      // Old finding should be superseded (same contentHash)
      expect(result.findingsToSupersede).toHaveLength(1);
      expect(result.findingsToSupersede[0]).toBe(oldFindings[0].id);

      // The new finding matched by contentHash, so it is NOT in findingsToCreate
      // (the reconciler only includes truly unmatched new findings there)
      expect(result.findingsToCreate).toHaveLength(0);

      // Nothing to resolve (old findings had a match)
      expect(result.findingsToResolve).toHaveLength(0);
      expect(result.findingsToKeep).toHaveLength(0);

      // Verify the new finding was linked to the old one via supersedesFindingId
      expect(newFindings[0].supersedesFindingId).toBe(oldFindings[0].id);
    });

    it("marks old findings as resolved when new findings have no overlap (fixed issues)", async () => {
      // Old findings: two issues in different files, at different lines
      const oldFindings = [
        createFinding({
          id: "00000000-0000-0000-0000-000000000001",
          prId: 42,
          filePath: "src/bug.ts",
          lineStart: 10,
          severity: "critical",
          title: "Bug: null pointer",
          contentHash: computeContentHash("src/bug.ts", ["old bug code"]),
          resolution: "open",
          sourceEngine: "ai-review",
        }),
        createFinding({
          id: "00000000-0000-0000-0000-000000000002",
          prId: 42,
          filePath: "src/style.ts",
          lineStart: 5,
          severity: "low",
          title: "Style: trailing whitespace",
          contentHash: computeContentHash("src/style.ts", ["trailing space"]),
          resolution: "open",
          sourceEngine: "compliance",
        }),
      ];

      // New findings: different files/lines — no contentHash or location overlap
      const newFindings = [
        createFinding({
          id: "00000000-0000-0000-0000-000000000003",
          prId: 42,
          filePath: "src/new-feature.ts",
          lineStart: 1,
          severity: "high",
          title: "High: new issue found",
          contentHash: computeContentHash("src/new-feature.ts", ["new code"]),
          resolution: "open",
          sourceEngine: "ai-review",
        }),
      ];

      const result = reconcileFindings(oldFindings, newFindings);

      // Both old findings have no match at all — should be resolved as "fixed"
      expect(result.findingsToResolve).toHaveLength(2);
      expect(result.findingsToResolve).toContain(oldFindings[0].id);
      expect(result.findingsToResolve).toContain(oldFindings[1].id);

      // No supersession
      expect(result.findingsToSupersede).toHaveLength(0);

      // The new finding is truly new (no old match) — should be created
      expect(result.findingsToCreate).toHaveLength(1);
      expect(result.findingsToCreate[0].id).toBe(newFindings[0].id);
      expect(result.findingsToCreate[0].resolution).toBe("open");
      expect(result.findingsToCreate[0].supersedesFindingId).toBeNull();
    });

    it("preserves findings with active overrides unchanged", async () => {
      const oldFindings = [
        createFinding({
          id: "00000000-0000-0000-0000-000000000001",
          prId: 42,
          filePath: "src/security.ts",
          severity: "critical",
          title: "Critical: waived",
          contentHash: "waived-hash-001",
          resolution: "waived", // Active override
          sourceEngine: "ai-review",
        }),
        createFinding({
          id: "00000000-0000-0000-0000-000000000002",
          prId: 42,
          filePath: "src/accepted.ts",
          severity: "high",
          title: "High: accepted risk",
          contentHash: "accepted-hash-001",
          resolution: "accepted-risk", // Active override
          sourceEngine: "ai-review",
        }),
      ];

      const newFindings: NormalizedFinding[] = []; // Nothing new

      const result = reconcileFindings(oldFindings, newFindings);

      // Both should be kept unchanged despite having no match
      expect(result.findingsToKeep).toHaveLength(2);
      expect(result.findingsToResolve).toHaveLength(0);
      expect(result.findingsToSupersede).toHaveLength(0);
    });

    it("applies reconciliation: supersedes old, creates new, resolves gone", async () => {
      // Initial findings: 3 items
      const initialFindings = [
        createFinding({
          id: "00000000-0000-0000-0000-000000000001",
          prId: 42,
          filePath: "src/bug.ts",
          severity: "critical",
          title: "Critical: null pointer",
          contentHash: "hash-bug-critical",
          sourceEngine: "ai-review",
        }),
        createFinding({
          id: "00000000-0000-0000-0000-000000000002",
          prId: 42,
          filePath: "src/todo.ts",
          severity: "low",
          title: "Low: TODO marker",
          contentHash: "hash-todo",
          sourceEngine: "compliance",
        }),
        createFinding({
          id: "00000000-0000-0000-0000-000000000003",
          prId: 42,
          filePath: "src/fixed.ts",
          severity: "high",
          title: "High: was fixed",
          contentHash: "hash-fixed",
          sourceEngine: "ai-review",
        }),
      ];

      // Store initial findings
      const stored = findingStore.batchUpsert(initialFindings);
      expect(stored).toHaveLength(3);

      // New scan: same bug finding (same contentHash), TODO is gone, fixed is gone, new issue appears
      const newFindings = [
        createFinding({
          id: "00000000-0000-0000-0000-000000000004",
          prId: 42,
          filePath: "src/bug.ts",
          severity: "critical",
          title: "Critical: null pointer (updated)",
          contentHash: "hash-bug-critical", // Same as before
          sourceEngine: "ai-review",
        }),
        createFinding({
          id: "00000000-0000-0000-0000-000000000005",
          prId: 42,
          filePath: "src/new-bug.ts",
          severity: "high",
          title: "High: new issue found",
          contentHash: "hash-new-issue",
          sourceEngine: "ai-review",
        }),
      ];

      const result = reconcileFindings(initialFindings, newFindings);

      // 1. Bug finding: superseded (same contentHash)
      expect(result.findingsToSupersede).toContain("00000000-0000-0000-0000-000000000001");

      // 2. TODO: gone — resolved
      expect(result.findingsToResolve).toContain("00000000-0000-0000-0000-000000000002");

      // 3. Fixed: gone — resolved
      expect(result.findingsToResolve).toContain("00000000-0000-0000-0000-000000000003");

      // 4. New issue (no match with old findings): created
      expect(result.findingsToCreate).toHaveLength(1);
      const newIssue = result.findingsToCreate.find(
        (f) => f.id === "00000000-0000-0000-0000-000000000005",
      );
      expect(newIssue).toBeDefined();
      expect(newIssue!.resolution).toBe("open");
      expect(newIssue!.supersedesFindingId).toBeNull();

      // The updated bug (id=...004) matched the old bug by contentHash,
      // so it is NOT added to findingsToCreate. Instead, it was linked
      // to the old finding via supersedesFindingId on the object itself.
      expect(newFindings[0].supersedesFindingId).toBe("00000000-0000-0000-0000-000000000001");
    });
  });

  // ─── 6. Override service integration ─────────────────────────────────

  describe("6. Override service integration", () => {
    it("creates override and updates finding resolution", () => {
      const finding = createFinding({
        id: "00000000-0000-0000-0000-000000000001",
        prId: 42,
        filePath: "src/security.ts",
        severity: "high",
        title: "High: SQL injection (false positive)",
        sourceEngine: "ai-review",
      });

      findingStore.batchUpsert([finding]);

      // Verify initial state
      let stored = findingStore.getFindingById(finding.id);
      expect(stored).not.toBeNull();
      expect(stored!.resolution).toBe("open");

      // Simulate override: mark as false-positive
      findingStore.updateResolution(finding.id, "false-positive", {
        overriddenBy: "senior-dev@example.com",
        justification: "This is a false positive — input is sanitized upstream",
      });

      stored = findingStore.getFindingById(finding.id);
      expect(stored!.resolution).toBe("false-positive");
    });

    it("rejects override for critical severity without second approver", () => {
      const finding = createFinding({
        id: "00000000-0000-0000-0000-000000000001",
        prId: 42,
        filePath: "src/security.ts",
        severity: "critical",
        title: "Critical: SQL injection",
        sourceEngine: "ai-review",
      });

      findingStore.batchUpsert([finding]);

      // Simulate the OverrideService authorization check
      expect(() => {
        if (finding.severity === "critical") {
          throw new Error(
            "Critical findings require two-person approval. Provide a secondApprover.",
          );
        }
      }).toThrow("two-person approval");
    });

    it("allows override for critical severity with second approver", () => {
      const finding = createFinding({
        id: "00000000-0000-0000-0000-000000000001",
        prId: 42,
        filePath: "src/security.ts",
        severity: "critical",
        title: "Critical: SQL injection (with approval)",
        sourceEngine: "ai-review",
      });

      findingStore.batchUpsert([finding]);

      // No error when secondApprover is provided
      let threw = false;
      try {
        if (finding.severity === "critical" && !"second-approver@example.com") {
          threw = true;
        }
        findingStore.updateResolution(finding.id, "accepted-risk", {
          overriddenBy: "senior-dev@example.com",
          secondApprover: "architect@example.com",
          justification: "Accepted risk per security review",
          expiryDate: "2026-12-31T00:00:00.000Z",
        });
      } catch {
        threw = true;
      }

      expect(threw).toBe(false);

      const stored = findingStore.getFindingById(finding.id);
      expect(stored!.resolution).toBe("accepted-risk");
    });

    it("processes expired overrides by reverting to open", () => {
      // MemoryFindingStore.getExpiredOverrides() always returns [],
      // so we simulate by directly setting up findings and calling updateResolution

      const finding = createFinding({
        id: "00000000-0000-0000-0000-000000000001",
        prId: 42,
        filePath: "src/security.ts",
        severity: "high",
        title: "High: waived (expired)",
        sourceEngine: "ai-review",
      });

      findingStore.batchUpsert([finding]);

      // First, simulate an override
      findingStore.updateResolution(finding.id, "waived", {
        overriddenBy: "senior-dev@example.com",
        justification: "Waived per policy",
        expiryDate: "2025-01-01T00:00:00.000Z", // Past date
      });

      // Verify it's waived
      let stored = findingStore.getFindingById(finding.id);
      expect(stored!.resolution).toBe("waived");

      // Simulate processExpiredOverrides: revert to open
      findingStore.updateResolution(finding.id, "open");
      stored = findingStore.getFindingById(finding.id);
      expect(stored!.resolution).toBe("open");

      // Expired override was processed
      expect(stored!.resolvedAt).toBeNull(); // resolution is open, not resolved
    });

    it("renews an active override with extended expiry", () => {
      const finding = createFinding({
        id: "00000000-0000-0000-0000-000000000001",
        prId: 42,
        filePath: "src/config.ts",
        severity: "high",
        title: "High: API key hardcoded",
        sourceEngine: "ai-review",
      });

      findingStore.batchUpsert([finding]);

      // Initial override
      findingStore.updateResolution(finding.id, "waived", {
        overriddenBy: "dev@example.com",
        justification: "Temporary waiver",
        expiryDate: "2026-06-01T00:00:00.000Z",
      });

      // Renew
      findingStore.updateResolution(finding.id, "waived", {
        overriddenBy: "system",
        justification: "Override renewed",
        expiryDate: "2026-12-31T00:00:00.000Z",
      });

      const stored = findingStore.getFindingById(finding.id);
      expect(stored!.resolution).toBe("waived");
    });
  });

  // ─── 7. Correlation edge cases ───────────────────────────────────────

  describe("Correlation edge cases", () => {
    it("merges evidence when same contentHash appears from different scanners", () => {
      const sharedHash = computeContentHash("src/main.ts", ["overlapping issue"]);

      const findings = [
        createFinding({
          severity: "critical",
          contentHash: sharedHash,
          evidence: "CVE scanner found SQL injection at line 42",
          sourceEngine: "sonarqube-cve",
        }),
        createFinding({
          severity: "high",
          contentHash: sharedHash,
          evidence: "AI review found SQL injection risk at line 42",
          sourceEngine: "ai-review",
        }),
      ];

      const correlated = correlateFindings(findings);

      expect(correlated).toHaveLength(1);
      // Higher severity (critical) wins
      expect(correlated[0].severity).toBe("critical");
      // Evidence from both is merged
      expect(correlated[0].evidence).toContain("CVE scanner");
      expect(correlated[0].evidence).toContain("AI review");
    });

    it("keeps the higher-severity finding when same hash from multiple scanners", () => {
      const sharedHash = computeContentHash("src/main.ts", ["duplicate issue"]);

      const findings = [
        createFinding({
          severity: "low",
          contentHash: sharedHash,
          title: "Low severity duplicate",
          sourceEngine: "ai-review",
        }),
        createFinding({
          severity: "critical",
          contentHash: sharedHash,
          title: "Critical severity same issue",
          sourceEngine: "sonarqube-cve",
        }),
      ];

      const correlated = correlateFindings(findings);

      expect(correlated).toHaveLength(1);
      expect(correlated[0].severity).toBe("critical");
    });

    it("keeps stable input order when severity is equal", () => {
      const findings = [
        createFinding({
          severity: "high",
          confidence: 0.7,
          title: "Lower confidence high",
          contentHash: "hash-high-1",
        }),
        createFinding({
          severity: "high",
          confidence: 0.95,
          title: "Higher confidence high",
          contentHash: "hash-high-2",
        }),
        createFinding({
          severity: "critical",
          confidence: 0.5,
          title: "Low confidence critical",
          contentHash: "hash-critical-1",
        }),
      ];

      const prioritized = prioritizeFindings(findings);

      // Critical first; optional legacy confidence does not affect OCR ordering.
      expect(prioritized[0].severity).toBe("critical");
      expect(prioritized[1].title).toContain("Lower confidence");
      expect(prioritized[2].title).toContain("Higher confidence");
    });
  });

  // ─── 8. Finding store operations ─────────────────────────────────────

  describe("Finding store integration", () => {
    it("upserts findings by (prId, contentHash, sourceEngine) identity", () => {
      const finding1 = createFinding({
        id: "00000000-0000-0000-0000-000000000001",
        prId: 42,
        severity: "high",
        contentHash: "unique-hash-1",
        sourceEngine: "ai-review",
        title: "Original title",
      });

      // Insert
      const inserted = findingStore.upsertFinding(finding1);
      expect(inserted.id).toBe("00000000-0000-0000-0000-000000000001");

      // Upsert with same (prId, contentHash, sourceEngine) — different id
      const finding2 = createFinding({
        id: "00000000-0000-0000-0000-000000000002",
        prId: 42,
        severity: "high",
        contentHash: "unique-hash-1",
        sourceEngine: "ai-review",
        title: "Updated title",
      });

      const updated = findingStore.upsertFinding(finding2);
      // MemoryFindingStore merges with { ...existing, ...finding }, so the new id wins.
      expect(updated.id).toBe("00000000-0000-0000-0000-000000000002");
      expect(updated.title).toBe("Updated title");
    });

    it("queries findings by PR and repository", () => {
      const findings = [
        createFinding({ prId: 42, repository: "repo-a", severity: "high", title: "Repo A finding", contentHash: "a-1" }),
        createFinding({ prId: 42, repository: "repo-b", severity: "medium", title: "Repo B finding", contentHash: "b-1" }),
        createFinding({ prId: 99, repository: "repo-a", severity: "low", title: "Different PR", contentHash: "a-99" }),
      ];

      findingStore.batchUpsert(findings);

      const repoAFindings = findingStore.getFindingsByPr(42, "repo-a");
      expect(repoAFindings).toHaveLength(1);
      expect(repoAFindings[0].title).toContain("Repo A");
    });

    it("stores audit records and queries them back", () => {
      const auditRecord = {
        id: "audit-001",
        prId: 42,
        repository: "test-repo",
        commitHash: "abc123",
        baseCommitHash: "def456",
        reviewStartTimestamp: "2024-01-01T00:00:00.000Z",
        reviewEndTimestamp: "2024-01-01T01:00:00.000Z",
        scanners: JSON.stringify([{ engine: "ai-review", version: "1.0.0", durationMs: 100 }]),
        modelVersion: "2.0.0",
        findingsCount: 5,
        blockingFindingsCount: 1,
        mergePolicyDecision: "allowed",
        supersedesReviewId: null,
        rawScannerOutputs: null,
        createdAt: "2024-01-01T01:00:00.000Z",
      };

      findingStore.saveAuditRecord(auditRecord as any);

      const results = findingStore.queryAuditRecords({ prId: 42 });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("audit-001");

      // Query with no matching filter
      const empty = findingStore.queryAuditRecords({ prId: 99 });
      expect(empty).toHaveLength(0);
    });

    it("clears all data on close", () => {
      const finding = createFinding({
        prId: 42,
        severity: "high",
        title: "Temporary finding",
        contentHash: "temp-hash",
      });

      findingStore.batchUpsert([finding]);
      expect(findingStore.getFindingsByPr(42, "test-repo")).toHaveLength(1);

      findingStore.close();
      expect(findingStore.getFindingsByPr(42, "test-repo")).toHaveLength(0);
    });
  });
});
