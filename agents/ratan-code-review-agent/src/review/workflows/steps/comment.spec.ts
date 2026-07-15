import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FindingStore } from "../../../../../../packages/finding-store/src/index";
import { getAgentConfigSessions } from "../../../bootstrap/session";
import { RequestContext } from "../../runtime";
import { comment } from "./comment";

let tempDir: string | undefined;

afterEach(() => {
  getAgentConfigSessions().clearSessions();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("comment", () => {
  it("links each created inline ADO thread to its finding", async () => {
    const addCommentThreadForPRCode = vi.fn().mockResolvedValue({ id: 101 });
    const { dbPath, requestContext } = setupCommentTest(
      "comment-step-test",
      "comment-step-",
      addCommentThreadForPRCode,
    );
    const persistedStore = new FindingStore(dbPath);
    persistedStore.init();
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
      agents: { getAgent: vi.fn() },
      getStepResult: vi.fn(),
    });
    await comment.execute({
      inputData,
      requestContext,
      agents: { getAgent: vi.fn() },
      getStepResult: vi.fn(),
    });

    const store = new FindingStore(dbPath);
    store.init();
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
    store.close();
  });

  it("keeps a SQLite thread link idempotent and scoped to its PR", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-store-"));
    const store = new FindingStore(path.join(tempDir, "findings.db"));
    store.init();
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
    const { dbPath, requestContext } = setupCommentTest(
      "comment-order-test",
      "comment-order-",
      addCommentThreadForPRCode,
    );
    const store = new FindingStore(dbPath);
    store.init();
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
      agents: { getAgent: vi.fn() },
      getStepResult: vi.fn(),
    });

    expect(
      addCommentThreadForPRCode.mock.calls.map(([input]) => input.comment),
    ).toEqual([
      expect.stringContaining("Blocking finding"),
      expect.stringContaining("Critical finding"),
      expect.stringContaining("Low finding"),
    ]);
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
    store.init();
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
      agents: { getAgent: vi.fn() },
      getStepResult: vi.fn(),
    });

    expect(addCommentThreadForPRCode).toHaveBeenCalledTimes(30);
    expect(result.codeCommentIds).toHaveLength(30);
  });
});

function setupCommentTest(
  providerId: string,
  tempPrefix: string,
  addCommentThreadForPRCode: ReturnType<typeof vi.fn>,
) {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), tempPrefix));
  const dbPath = path.join(tempDir, "findings.db");
  const provider = {
    id: providerId,
    getAdoClient: () => ({
      addCommentThreadForPRCode,
      addCommentForPR: vi.fn().mockResolvedValue({ id: 999 }),
      setPullRequestProperties: vi.fn().mockResolvedValue(undefined),
    }),
    getRootConfig: vi.fn().mockResolvedValue({ findingStorePath: dbPath }),
  };
  getAgentConfigSessions().registerProvider(provider as never);
  const requestContext = new RequestContext<{ configSessionId: string }>();
  requestContext.set("configSessionId", provider.id);
  return { dbPath, requestContext };
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
