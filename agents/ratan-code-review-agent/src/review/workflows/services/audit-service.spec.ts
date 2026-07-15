import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FindingStore } from "finding-store";
import { AuditService } from "./audit-service";

describe("AuditService", () => {
  it("stores scanner arrays and raw outputs without double encoding", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "audit-service-"));
    const store = new FindingStore(path.join(dir, "findings.db"));
    try {
      store.init();
      const service = new AuditService(store);

      await service.recordReview({
        id: "550e8400-e29b-41d4-a716-446655440000",
        prId: 123,
        repository: "repo",
        commitHash: "abc",
        baseCommitHash: "def",
        reviewStartTimestamp: "2024-01-01T00:00:00.000Z",
        reviewEndTimestamp: "2024-01-01T00:01:00.000Z",
        scanners: [
          { engine: "open-code-review", version: "1.7.7", durationMs: 12 },
        ],
        modelVersion: "review-model",
        findingsCount: 1,
        blockingFindingsCount: 0,
        mergePolicyDecision: "allowed",
        supersedesReviewId: null,
        rawScannerOutputs: {
          reviewExecutionStatus: "complete",
          reviewFocuses: [
            { focus: "general", reasons: ["Always selected."] },
          ],
          postableFindingCount: 1,
          duplicateSuppressionReasons: {
            contentHashCorrelation: 0,
            inlineContentHash: 0,
            previouslyLinkedThread: 0,
          },
        },
      });

      const [record] = store.queryAuditRecords({ prId: 123, repository: "repo" });

      expect(record.scanners).toEqual([
        { engine: "open-code-review", version: "1.7.7", durationMs: 12 },
      ]);
      expect(record.rawScannerOutputs).toEqual({
        reviewExecutionStatus: "complete",
        reviewFocuses: [
          { focus: "general", reasons: ["Always selected."] },
        ],
        postableFindingCount: 1,
        duplicateSuppressionReasons: {
          contentHashCorrelation: 0,
          inlineContentHash: 0,
          previouslyLinkedThread: 0,
        },
      });
    } finally {
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
