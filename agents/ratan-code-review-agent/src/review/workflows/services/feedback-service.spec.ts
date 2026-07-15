import { describe, expect, it, vi } from "vitest";
import { type NormalizedFinding } from "finding-store";
import { MemoryFindingStore } from "../../../../../../packages/finding-store/src/memory-store";
import { FeedbackService } from "./feedback-service";

describe("FeedbackService", () => {
  it("updates only the finding linked to a resolved ADO thread", async () => {
    const store = new MemoryFindingStore();
    const linkedFinding = finding("11111111-1111-4111-8111-111111111111");
    const unrelatedFinding = finding("22222222-2222-4222-8222-222222222222");
    store.upsertFinding(linkedFinding);
    store.upsertFinding(unrelatedFinding);
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

    const service = new FeedbackService(store as never);
    await service.syncAdoCommentThreads(
      {
        getAdoClient: () => ({
          getPullRequestThreads: vi.fn().mockResolvedValue([
            { id: 101, status: 2, comments: [] },
            { id: 202, status: 2, comments: [] },
          ]),
        }),
      } as never,
      7,
      "repo",
    );

    expect(store.getFindingById(linkedFinding.id)?.resolution).toBe("resolved");
    expect(store.getFindingById(unrelatedFinding.id)?.resolution).toBe("open");
  });

  it("rejects a thread link for a finding in another PR", () => {
    const store = new MemoryFindingStore();
    const linkedFinding = finding("11111111-1111-4111-8111-111111111111");
    store.upsertFinding(linkedFinding);

    expect(() =>
      store.linkCommentThread({
        repository: "repo",
        prId: 8,
        findingId: linkedFinding.id,
        threadId: 101,
      }),
    ).toThrow("Comment thread must belong to the finding's PR and repository");
  });
});

function finding(id: string): NormalizedFinding {
  return {
    id,
    prId: 7,
    repository: "repo",
    filePath: "/src/file.ts",
    lineStart: 4,
    lineEnd: 4,
    category: "bug",
    severity: "high",
    title: "Finding",
    description: "Description",
    evidence: "Evidence",
    businessImpact: "Impact",
    remediation: "Fix it",
    blocking: false,
    linkedTaskId: null,
    resolution: "open",
    sourceEngine: "open-code-review",
    sourceVersion: "1.0.0",
    supersedesFindingId: null,
    contentHash: id,
    createdAt: "2026-07-15T00:00:00.000Z",
    resolvedAt: null,
  };
}
