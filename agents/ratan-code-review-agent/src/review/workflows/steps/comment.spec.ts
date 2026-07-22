import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FindingStore } from "../../../../../../packages/finding-store/src/index";
import { getAgentConfigSessions } from "../../../bootstrap/session";
import { RequestContext } from "../../runtime";
import { comment, formatInlineFinding, formatReviewConclusion } from "./comment";

let tempDir: string | undefined;

afterEach(() => {
  getAgentConfigSessions().clearSessions();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("comment", () => {
  it("formats inline findings like a concise prioritized review note", () => {
    expect(formatInlineFinding(finding())).toBe(
      "### P1 · HIGH — Finding\n\nDescription\n\n**Suggested fix:**\n\n```\nFix it\n```\n\nUseful? Reply with 👍 or 👎.",
    );
  });

  it("keeps a model-generated title to one concise sentence", () => {
    const formatted = formatInlineFinding({
      ...finding(),
      severity: "critical",
      title:
        "SQL Injection vulnerability: the email parameter is directly interpolated into the SQL query string. An attacker can supply a malicious value that changes the query.",
    });

    expect(formatted).toContain(
      "### P0 · CRITICAL — SQL Injection vulnerability: the email parameter is directly interpolated into the SQL query string.\n\nDescription",
    );
    expect(formatted).not.toContain("An attacker can supply");
  });

  it("escapes model-generated Markdown in the heading", () => {
    const formatted = formatInlineFinding({
      ...finding(),
      title: "Unsafe **markdown** [label](target) with `code`",
    });

    expect(formatted).toContain(
      "### P1 · HIGH — Unsafe \\*\\*markdown\\*\\* \\[label\\](target) with \\`code\\`",
    );
  });

  it("keeps the conclusion limited to decision, SonarQube, and commit", () => {
    const conclusion = formatReviewConclusion({
      findings: [{ ...finding(), blocking: true }],
      latestSourceCommitId: "1234567890abcdef",
      measures: {
        coverage: 87.5,
        new_bugs: 1,
        new_vulnerabilities: 2,
        new_code_smells: 3,
      },
      mergeDecision: "blocked",
    });

    expect(conclusion).toBe(
      "<!-- pr-guardian:review-summary -->\n## PR Guardian Review\n\n### ❌ Changes requested\n\n1 blocking finding. See the inline comment for details.\n\n**SonarQube:** Coverage 87.5% · New bugs 1 · New vulnerabilities 2 · New code smells 3\n\n**Reviewed commit:** `1234567890`",
    );
    expect(conclusion).not.toContain("audit");
  });

  it.each([
    {
      name: "clean follow-up",
      findings: [],
      mergeDecision: "allowed" as const,
      expected: "### ✅ No blocking issues\n\nNo merge-blocking issues were found.",
    },
    {
      name: "non-blocking follow-up",
      findings: [finding()],
      mergeDecision: "allowed" as const,
      expected: "### ✅ No blocking issues\n\n1 non-blocking suggestion is noted inline.",
    },
    {
      name: "incomplete follow-up",
      findings: [],
      mergeDecision: "pending" as const,
      expected: "### ⚠️ Review incomplete\n\nAutomated review did not finish. Manual review is required.",
    },
  ])("renders the $name conclusion without inventing SonarQube data", ({
    findings,
    mergeDecision,
    expected,
  }) => {
    const conclusion = formatReviewConclusion({
      findings,
      latestSourceCommitId: "1234567890abcdef",
      measures: null,
      mergeDecision,
    });

    expect(conclusion).toContain(expected);
    expect(conclusion).toContain("**SonarQube:** Not available");
    expect(conclusion.match(/## PR Guardian Review/g)).toHaveLength(1);
  });

  it("links each created inline ADO thread to its finding", async () => {
    const addCommentThreadForPRCode = vi.fn().mockResolvedValue({ id: 101 });
    const { dbPath, requestContext, gitApi } = setupCommentTest(
      "comment-step-test",
      "comment-step-",
      addCommentThreadForPRCode,
    );
    const persistedStore = new FindingStore(dbPath);
    await persistedStore.init();
    const originalFinding = finding();
    persistedStore.upsertFinding(originalFinding);
    const persistedFinding = persistedStore.upsertFinding({
      ...finding(),
      id: "22222222-2222-4222-8222-222222222222",
    });
    persistedStore.close();

    const inputData = {
      prDetails: {
        repoId: "repo-id",
        repoName: "repo",
        pullRequestId: 7,
        latestSourceCommitId: "head",
      },
      findings: [persistedFinding],
      correlationSummary: "Found 1 issue",
      reviewSummary: "Review summary",
      reviewExecutionStatus: "complete",
      reviewMetadata: {},
      measures: null,
      mergeDecision: "allowed",
      createdWorkItems: 0,
    } as const;

    await comment.execute({
      inputData,
      requestContext,
    });
    await comment.execute({
      inputData,
      requestContext,
    });

    const store = new FindingStore(dbPath);
    await store.init();
    expect(store.getCommentThreadsByPr(7, "repo")).toEqual([
      expect.objectContaining({
        repository: "repo",
        prId: 7,
        findingId: originalFinding.id,
        threadId: 101,
        createdAt: expect.any(String),
      }),
    ]);
    expect(addCommentThreadForPRCode).toHaveBeenCalledTimes(1);
    expect(gitApi.createThread).toHaveBeenCalledTimes(2);
    expect(gitApi.updateComment).toHaveBeenCalledTimes(1);
    expect(gitApi.updateComment).toHaveBeenCalledWith(
      {
        content: "### P1 · HIGH — Finding\n\nDescription\n\n**Suggested fix:**\n\n```\nFix it\n```\n\nUseful? Reply with 👍 or 👎.",
      },
      "repo-id",
      7,
      101,
      1,
      "project",
    );
    store.close();
  });

  it("keeps a SQLite thread link idempotent and scoped to its PR", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-store-"));
    const store = new FindingStore(path.join(tempDir, "findings.db"));
    await store.init();
    const linkedFinding = finding();
    const otherFinding = {
      ...finding(),
      id: "22222222-2222-4222-8222-222222222222",
      prId: 8,
      repository: "other-repo",
      contentHash: "other-hash",
    };
    store.upsertFinding(linkedFinding);
    store.upsertFinding(otherFinding);

    store.linkCommentThread({
      repository: "repo",
      prId: 7,
      findingId: linkedFinding.id,
      threadId: 101,
    });
    store.linkCommentThread({
      repository: "repo",
      prId: 7,
      findingId: linkedFinding.id,
      threadId: 101,
    });

    expect(store.getCommentThreadsByPr(7, "repo")).toHaveLength(1);
    expect(store.getCommentThreadsByPr(8, "other-repo")).toEqual([]);
    expect(() =>
      store.linkCommentThread({
        repository: "repo",
        prId: 7,
        findingId: otherFinding.id,
        threadId: 102,
      }),
    ).toThrow("Comment thread must belong to the finding's PR and repository");
    store.close();
  });

  it("posts blocking and higher-severity inline findings first", async () => {
    const addCommentThreadForPRCode = vi
      .fn()
      .mockResolvedValueOnce({ id: 101 })
      .mockResolvedValueOnce({ id: 102 })
      .mockResolvedValueOnce({ id: 103 });
    const { dbPath, requestContext, gitApi } = setupCommentTest(
      "comment-order-test",
      "comment-order-",
      addCommentThreadForPRCode,
    );
    const store = new FindingStore(dbPath);
    await store.init();
    const low = store.upsertFinding({
      ...finding(),
      id: "11111111-1111-4111-8111-111111111111",
      title: "Low finding",
      severity: "low",
      contentHash: "low",
    });
    const critical = store.upsertFinding({
      ...finding(),
      id: "22222222-2222-4222-8222-222222222222",
      title: "Critical finding",
      severity: "critical",
      contentHash: "critical",
    });
    const blocking = store.upsertFinding({
      ...finding(),
      id: "33333333-3333-4333-8333-333333333333",
      title: "Blocking finding",
      severity: "medium",
      blocking: true,
      contentHash: "blocking",
    });
    store.close();

    await comment.execute({
      inputData: {
        prDetails: {
          repoId: "repo-id",
          repoName: "repo",
          pullRequestId: 7,
          latestSourceCommitId: "head",
        },
        findings: [low, critical, blocking],
        correlationSummary: "Found 3 issues",
        reviewSummary: "Review summary",
        reviewExecutionStatus: "complete",
        reviewMetadata: {},
        measures: null,
        mergeDecision: "blocked",
        createdWorkItems: 0,
      },
      requestContext,
    });

    expect(
      addCommentThreadForPRCode.mock.calls.map(([input]) => input.comment),
    ).toEqual([
      expect.stringContaining("Blocking finding"),
      expect.stringContaining("Critical finding"),
      expect.stringContaining("Low finding"),
    ]);
    expect(gitApi.createThread).toHaveBeenCalledWith(
      expect.objectContaining({
        comments: [
          expect.objectContaining({
            content: expect.stringContaining("### ❌ Changes requested"),
          }),
        ],
        status: 4,
      }),
      "repo",
      7,
      "project",
    );
  });

  it("deletes old conclusions and creates the canonical conclusion after inline comments", async () => {
    const legacy = (conclusion: string) =>
      `### Conclusion: ${conclusion}\n\n### PR Description:\n\nNoise\n\nRatan Code Review Agent`;
    const addCommentThreadForPRCode = vi.fn().mockResolvedValue({ id: 101 });
    const { requestContext, gitApi } = setupCommentTest(
      "comment-upsert-test",
      "comment-upsert-",
      addCommentThreadForPRCode,
      [
        { id: 4, comments: [{ id: 1, content: legacy("✅ Approve for New Commits") }] },
        { id: 5, comments: [{ id: 1, content: legacy("Need Work") }] },
      ],
    );

    await comment.execute({
      inputData: {
        prDetails: {
          repoId: "repo-id",
          repoName: "repo",
          pullRequestId: 7,
          latestSourceCommitId: "1234567890abcdef",
        },
        findings: [{ ...finding(), blocking: true }],
        correlationSummary: "audit noise",
        reviewSummary: "more audit noise",
        reviewExecutionStatus: "complete",
        reviewMetadata: { noisy: true },
        measures: { coverage: 1 },
        mergeDecision: "blocked",
        createdWorkItems: 3,
      },
      requestContext,
    });

    expect(gitApi.deleteComment).toHaveBeenCalledWith(
      "repo",
      7,
      4,
      1,
      "project",
    );
    expect(gitApi.deleteComment).toHaveBeenCalledWith(
      "repo",
      7,
      5,
      1,
      "project",
    );
    expect(gitApi.createThread).toHaveBeenCalledWith(
      expect.objectContaining({
        comments: [{ content: expect.stringContaining("### ❌ Changes requested") }],
      }),
      "repo",
      7,
      "project",
    );
    expect(addCommentThreadForPRCode.mock.invocationCallOrder[0]).toBeLessThan(
      gitApi.createThread.mock.invocationCallOrder[0],
    );
  });

  it("closes the fixed finding thread and posts a newest conclusion after a fix commit", async () => {
    const addCommentThreadForPRCode = vi.fn().mockResolvedValue({ id: 102 });
    const { dbPath, requestContext, gitApi, updateCommentThreadStatus } =
      setupCommentTest(
        "comment-fixed-test",
        "comment-fixed-",
        addCommentThreadForPRCode,
        [
          {
            id: 999,
            comments: [{
              id: 1,
              content: "<!-- pr-guardian:review-summary -->\n### ❌ Changes requested",
            }],
          },
        ],
      );
    const store = new FindingStore(dbPath);
    await store.init();
    store.upsertFinding(finding());
    store.linkCommentThread({
      repository: "repo",
      prId: 7,
      findingId: finding().id,
      threadId: 101,
    });
    store.updateResolution(finding().id, "resolved");
    store.close();

    const result = await comment.execute({
      inputData: {
        prDetails: {
          repoId: "repo-id",
          repoName: "repo",
          pullRequestId: 7,
          latestSourceCommitId: "fixed1234567890",
        },
        findings: [],
        correlationSummary: "No issues",
        reviewSummary: "Clean",
        reviewExecutionStatus: "complete",
        reviewMetadata: {},
        measures: {
          coverage: 92,
          new_bugs: 0,
          new_vulnerabilities: 0,
          new_code_smells: 0,
        },
        mergeDecision: "allowed",
        createdWorkItems: 0,
      },
      requestContext,
    });

    expect(updateCommentThreadStatus).toHaveBeenCalledWith(
      "repo-id",
      7,
      101,
      2,
    );
    expect(addCommentThreadForPRCode).not.toHaveBeenCalled();
    expect(result.mainCommentId).toBe(1000);
    expect(gitApi.createThread).toHaveBeenCalledWith(
      expect.objectContaining({
        comments: [{
          content: expect.stringMatching(
            /### ✅ No blocking issues[\s\S]*Coverage 92% · New bugs 0 · New vulnerabilities 0 · New code smells 0[\s\S]*`fixed12345`/,
          ),
        }],
      }),
      "repo",
      7,
      "project",
    );
    expect(gitApi.deleteComment).toHaveBeenCalledWith(
      "repo",
      7,
      999,
      1,
      "project",
    );
  });

  it("closes the original thread when a location-matched descendant is later fixed", async () => {
    const { dbPath, requestContext, updateCommentThreadStatus } =
      setupCommentTest(
        "comment-descendant-fixed-test",
        "comment-descendant-fixed-",
        vi.fn(),
      );
    const original = {
      ...finding(),
      id: "11111111-1111-4111-8111-111111111111",
      contentHash: "old-hash",
      resolution: "superseded" as const,
    };
    const fixedDescendant = {
      ...finding(),
      id: "22222222-2222-4222-8222-222222222222",
      contentHash: "changed-hash",
      resolution: "resolved" as const,
      supersedesFindingId: original.id,
    };
    const store = new FindingStore(dbPath);
    await store.init();
    store.batchUpsert([original, fixedDescendant]);
    store.linkCommentThread({
      repository: "repo",
      prId: 7,
      findingId: original.id,
      threadId: 101,
    });
    store.close();

    await executeCommentReview(requestContext, {
      findings: [],
      latestSourceCommitId: "fixed-descendant",
      measures: null,
      mergeDecision: "allowed",
    });

    expect(updateCommentThreadStatus).toHaveBeenCalledWith(
      "repo-id",
      7,
      101,
      2,
    );
  });

  it("keeps one summary while a real two-review lifecycle moves from blocked to allowed", async () => {
    const addCommentThreadForPRCode = vi.fn().mockResolvedValue({ id: 101 });
    const { dbPath, requestContext, gitApi, updateCommentThreadStatus } =
      setupCommentTest(
        "comment-lifecycle-test",
        "comment-lifecycle-",
        addCommentThreadForPRCode,
      );
    const original = { ...finding(), blocking: true };
    const store = new FindingStore(dbPath);
    await store.init();
    store.upsertFinding(original);
    store.close();

    await executeCommentReview(requestContext, {
      findings: [original],
      latestSourceCommitId: "blocked123456789",
      measures: {
        coverage: 70,
        new_bugs: 1,
        new_vulnerabilities: 1,
        new_code_smells: 2,
      },
      mergeDecision: "blocked",
    });

    const fixedStore = new FindingStore(dbPath);
    await fixedStore.init();
    fixedStore.updateResolution(original.id, "resolved");
    fixedStore.close();

    const fixedResult = await executeCommentReview(requestContext, {
      findings: [],
      latestSourceCommitId: "allowed123456789",
      measures: {
        coverage: 96,
        new_bugs: 0,
        new_vulnerabilities: 0,
        new_code_smells: 0,
      },
      mergeDecision: "allowed",
    });

    expect(gitApi.createThread).toHaveBeenCalledTimes(2);
    expect(addCommentThreadForPRCode).toHaveBeenCalledTimes(1);
    expect(updateCommentThreadStatus).toHaveBeenCalledWith(
      "repo-id",
      7,
      101,
      2,
    );
    expect(fixedResult.mainCommentId).toBe(1000);
    expect(gitApi.createThread).toHaveBeenLastCalledWith(
      expect.objectContaining({
        comments: [{
          content: expect.stringMatching(
            /### ✅ No blocking issues[\s\S]*Coverage 96% · New bugs 0 · New vulnerabilities 0 · New code smells 0[\s\S]*`allowed123`/,
          ),
        }],
      }),
      "repo",
      7,
      "project",
    );
  });

  it("closes fixed, refreshes unchanged, and comments only on new findings in a mixed commit", async () => {
    const addCommentThreadForPRCode = vi.fn().mockResolvedValue({ id: 103 });
    const { dbPath, requestContext, gitApi, updateCommentThreadStatus } =
      setupCommentTest(
        "comment-mixed-test",
        "comment-mixed-",
        addCommentThreadForPRCode,
        [
          {
            id: 999,
            comments: [{
              id: 1,
              content: "<!-- pr-guardian:review-summary -->\n### ❌ Changes requested",
            }],
          },
        ],
      );
    const fixedOld = {
      ...finding(),
      id: "11111111-1111-4111-8111-111111111111",
      filePath: "/src/fixed.ts",
      contentHash: "fixed-hash",
      resolution: "resolved" as const,
    };
    const unchangedOld = {
      ...finding(),
      id: "22222222-2222-4222-8222-222222222222",
      title: "Old unchanged title",
      contentHash: "unchanged-hash",
      resolution: "superseded" as const,
    };
    const unchangedNew = {
      ...finding(),
      id: "33333333-3333-4333-8333-333333333333",
      title: "Updated unchanged title",
      contentHash: "unchanged-hash",
      supersedesFindingId: unchangedOld.id,
    };
    const introduced = {
      ...finding(),
      id: "44444444-4444-4444-8444-444444444444",
      title: "New blocking regression",
      filePath: "/src/new.ts",
      contentHash: "new-hash",
      blocking: true,
    };
    const store = new FindingStore(dbPath);
    await store.init();
    store.batchUpsert([fixedOld, unchangedOld, unchangedNew, introduced]);
    store.linkCommentThread({
      repository: "repo",
      prId: 7,
      findingId: fixedOld.id,
      threadId: 101,
    });
    store.linkCommentThread({
      repository: "repo",
      prId: 7,
      findingId: unchangedOld.id,
      threadId: 102,
    });
    store.close();

    const result = await comment.execute({
      inputData: {
        prDetails: {
          repoId: "repo-id",
          repoName: "repo",
          pullRequestId: 7,
          latestSourceCommitId: "mixed1234567890",
        },
        findings: [unchangedNew, introduced],
        correlationSummary: "Mixed update",
        reviewSummary: "Mixed update",
        reviewExecutionStatus: "complete",
        reviewMetadata: {},
        measures: null,
        mergeDecision: "blocked",
        createdWorkItems: 0,
      },
      requestContext,
    });

    expect(updateCommentThreadStatus).toHaveBeenCalledWith(
      "repo-id",
      7,
      101,
      2,
    );
    expect(gitApi.updateComment).toHaveBeenCalledWith(
      { content: expect.stringContaining("Updated unchanged title") },
      "repo-id",
      7,
      102,
      1,
      "project",
    );
    expect(addCommentThreadForPRCode).toHaveBeenCalledTimes(1);
    expect(addCommentThreadForPRCode).toHaveBeenCalledWith(
      expect.objectContaining({
        comment: expect.stringContaining("New blocking regression"),
      }),
    );
    expect(result).toEqual({ mainCommentId: 1000, codeCommentIds: [103] });

    const persisted = new FindingStore(dbPath);
    await persisted.init();
    expect(persisted.getCommentThreadsByPr(7, "repo")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ findingId: introduced.id, threadId: 103 }),
      ]),
    );
    persisted.close();
  });

  it("posts at most 30 inline comments", async () => {
    const addCommentThreadForPRCode = vi.fn(async () => ({
      id: 100 + addCommentThreadForPRCode.mock.calls.length,
    }));
    const { dbPath, requestContext } = setupCommentTest(
      "comment-cap-test",
      "comment-cap-",
      addCommentThreadForPRCode,
    );
    const store = new FindingStore(dbPath);
    await store.init();
    const findings = Array.from({ length: 31 }, (_, index) =>
      store.upsertFinding({
        ...finding(),
        id: `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
        title: `Finding ${index + 1}`,
        contentHash: `hash-${index + 1}`,
      }),
    );
    store.close();

    const result = await comment.execute({
      inputData: {
        prDetails: {
          repoId: "repo-id",
          repoName: "repo",
          pullRequestId: 7,
          latestSourceCommitId: "head",
        },
        findings,
        correlationSummary: "Found 31 issues",
        reviewSummary: "Review summary",
        reviewExecutionStatus: "complete",
        reviewMetadata: {},
        measures: null,
        mergeDecision: "allowed",
        createdWorkItems: 0,
      },
      requestContext,
    });

    expect(addCommentThreadForPRCode).toHaveBeenCalledTimes(30);
    expect(result.codeCommentIds).toHaveLength(30);
  });
});

function setupCommentTest(
  providerId: string,
  tempPrefix: string,
  addCommentThreadForPRCode: ReturnType<typeof vi.fn>,
  initialThreads: Array<{
    id?: number;
    comments?: Array<{ id?: number; content?: string; isDeleted?: boolean }>;
    isDeleted?: boolean;
  }> = [],
) {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), tempPrefix));
  const dbPath = path.join(tempDir, "findings.db");
  const threads = structuredClone(initialThreads);
  const updateCommentThreadStatus = vi.fn().mockResolvedValue(undefined);
  const gitApi = {
    createThread: vi.fn(async (payload: { comments?: Array<{ content?: string }> }) => {
      const created = {
        id: Math.max(998, ...threads.map((thread) => thread.id ?? 0)) + 1,
        comments: [{ id: 1, content: payload.comments?.[0]?.content }],
      };
      threads.push(created);
      return created;
    }),
    updateComment: vi.fn(async (
      payload: { content?: string },
      _repo: string,
      _prId: number,
      threadId: number,
      commentId: number,
    ) => {
      const comment = threads
        .find((thread) => thread.id === threadId)
        ?.comments?.find((candidate) => candidate.id === commentId);
      if (comment) comment.content = payload.content;
      return comment;
    }),
    deleteComment: vi.fn(async (
      _repo: string,
      _prId: number,
      threadId: number,
      commentId: number,
    ) => {
      const thread = threads.find((candidate) => candidate.id === threadId);
      const comment = thread?.comments?.find((candidate) => candidate.id === commentId);
      if (comment) comment.isDeleted = true;
      if (thread?.comments?.every((candidate) => candidate.isDeleted)) {
        thread.isDeleted = true;
      }
    }),
  };
  const provider = {
    id: providerId,
    getAdoClient: () => ({
      addCommentThreadForPRCode,
      updateCommentThreadStatus,
      getPullRequestThreads: vi.fn(async () => threads),
      getCommentThreadById: vi.fn(async (
        _repoId: string,
        _prId: number,
        threadId: number,
      ) => ({
        id: threadId,
        comments: [{ id: 1, content: "old inline format" }],
      })),
      getAdoClient: () => ({ getGitApi: async () => gitApi }),
      getProjectName: () => "project",
      setPullRequestProperties: vi.fn().mockResolvedValue(undefined),
    }),
    getRootConfig: vi.fn().mockResolvedValue({ findingStorePath: dbPath }),
  };
  getAgentConfigSessions().registerProvider(provider as never);
  const requestContext = new RequestContext<{ configSessionId: string }>();
  requestContext.set("configSessionId", provider.id);
  return {
    dbPath,
    requestContext,
    gitApi,
    threads,
    updateCommentThreadStatus,
  };
}

function executeCommentReview(
  requestContext: RequestContext<{ configSessionId: string }>,
  overrides: {
    findings: ReturnType<typeof finding>[];
    latestSourceCommitId: string;
    measures: Record<string, number> | null;
    mergeDecision: "allowed" | "blocked" | "pending";
  },
) {
  return comment.execute({
    inputData: {
      prDetails: {
        repoId: "repo-id",
        repoName: "repo",
        pullRequestId: 7,
        latestSourceCommitId: overrides.latestSourceCommitId,
      },
      findings: overrides.findings,
      correlationSummary: "summary",
      reviewSummary: "review",
      reviewExecutionStatus: overrides.mergeDecision === "pending"
        ? "incomplete"
        : "complete",
      reviewMetadata: {},
      measures: overrides.measures,
      mergeDecision: overrides.mergeDecision,
      createdWorkItems: 0,
    },
    requestContext,
  });
}

function finding() {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    prId: 7,
    repository: "repo",
    filePath: "/src/file.ts",
    lineStart: 4,
    lineEnd: 4,
    category: "bug" as const,
    severity: "high" as const,
    title: "Finding",
    description: "Description",
    evidence: "Evidence",
    businessImpact: "Impact",
    remediation: "Fix it",
    blocking: false,
    linkedTaskId: null,
    resolution: "open" as const,
    sourceEngine: "open-code-review" as const,
    sourceVersion: "1.0.0",
    supersedesFindingId: null,
    contentHash: "hash",
    createdAt: "2026-07-15T00:00:00.000Z",
    resolvedAt: null,
  };
}
