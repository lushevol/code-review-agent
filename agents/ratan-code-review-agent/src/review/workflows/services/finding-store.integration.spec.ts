import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FindingStore } from "finding-store";

function createFinding(linkedTaskId: number | null) {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    prId: 7,
    repository: "repo",
    filePath: "src/main.ts",
    lineStart: 1,
    lineEnd: 1,
    category: "bug",
    severity: "high",
    confidence: 1,
    title: "Finding",
    description: "Description",
    evidence: "Evidence",
    businessImpact: "",
    remediation: "",
    blocking: true,
    linkedTaskId,
    resolution: "open",
    sourceEngine: "ai-review",
    sourceVersion: "1.0.0",
    supersedesFindingId: null,
    contentHash: "hash",
    createdAt: "2024-01-01T00:00:00.000Z",
    resolvedAt: null,
  };
}

describe("FindingStore integration", () => {
  it("updates linkedTaskId when an existing finding is upserted", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "finding-store-"));
    const store = new FindingStore(path.join(dir, "findings.db"));
    try {
      store.init();
      store.upsertFinding(createFinding(null));
      store.upsertFinding({
        ...createFinding(999),
        id: "550e8400-e29b-41d4-a716-446655440001",
      });

      const finding = store.getFindingsByPr(7, "repo")[0];
      expect(finding.linkedTaskId).toBe(999);
    } finally {
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
