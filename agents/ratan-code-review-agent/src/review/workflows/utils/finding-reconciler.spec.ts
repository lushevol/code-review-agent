import { beforeEach, describe, expect, it } from "vitest";
import { MemoryFindingStore } from "../../../../../../packages/finding-store/src/memory-store";
import type { NormalizedFinding } from "../../types/finding";
import { reconcileAndPersistFindings } from "./finding-reconciler";

describe("continued-commit finding reconciliation", () => {
  let store: MemoryFindingStore;

  beforeEach(async () => {
    store = new MemoryFindingStore();
    await store.init();
  });

  it("persists a disappeared blocking finding as resolved after a complete re-review", () => {
    const original = finding({ id: "old", blocking: true });
    store.upsertFinding(original);

    const result = reconcileAndPersistFindings(
      store,
      7,
      "repo",
      [],
      "complete",
    );

    expect(result.findingsToResolve).toEqual(["old"]);
    expect(store.getFindingById("old")).toMatchObject({
      resolution: "resolved",
      resolvedAt: expect.any(String),
    });
  });

  it("does not resolve findings when the re-review is incomplete", () => {
    store.upsertFinding(finding({ id: "old", blocking: true }));

    const result = reconcileAndPersistFindings(
      store,
      7,
      "repo",
      [],
      "incomplete",
    );

    expect(result.findingsToResolve).toEqual([]);
    expect(result.findingsToKeep).toEqual(["old"]);
    expect(store.getFindingById("old")?.resolution).toBe("open");
  });

  it("handles one unchanged, one fixed, and one new finding in the same commit", () => {
    store.batchUpsert([
      finding({ id: "unchanged-old", contentHash: "same-hash" }),
      finding({
        id: "fixed-old",
        filePath: "/src/fixed.ts",
        lineStart: 20,
        contentHash: "fixed-hash",
      }),
    ]);
    const unchangedNew = finding({
      id: "unchanged-new",
      contentHash: "same-hash",
    });
    const introduced = finding({
      id: "introduced",
      filePath: "/src/new.ts",
      lineStart: 40,
      contentHash: "new-hash",
    });

    const result = reconcileAndPersistFindings(
      store,
      7,
      "repo",
      [unchangedNew, introduced],
      "complete",
    );

    expect(result).toMatchObject({
      findingsToSupersede: ["unchanged-old"],
      findingsToResolve: ["fixed-old"],
      findingsToCreate: [expect.objectContaining({ id: "introduced" })],
    });
    expect(store.getFindingById("unchanged-old")?.resolution).toBe("superseded");
    expect(store.getFindingById("fixed-old")?.resolution).toBe("resolved");
    expect(store.getFindingById("unchanged-new")).toMatchObject({
      resolution: "open",
      supersedesFindingId: "unchanged-old",
    });
    expect(store.getFindingById("introduced")?.resolution).toBe("open");
  });

  it("reuses finding identity when a follow-up commit shifts the line by three", () => {
    store.upsertFinding(finding({
      id: "old",
      lineStart: 10,
      contentHash: "old-hash",
    }));
    const shifted = finding({
      id: "shifted",
      lineStart: 13,
      contentHash: "new-hash",
    });

    const result = reconcileAndPersistFindings(
      store,
      7,
      "repo",
      [shifted],
      "complete",
    );

    expect(result.findingsToSupersede).toEqual(["old"]);
    expect(store.getFindingById("shifted")?.supersedesFindingId).toBe("old");
  });

  it("treats a different category at the same location as a fixed issue plus a new issue", () => {
    store.upsertFinding(finding({ id: "old", category: "bug" }));
    const replacement = finding({
      id: "new",
      category: "security",
      contentHash: "different-hash",
    });

    const result = reconcileAndPersistFindings(
      store,
      7,
      "repo",
      [replacement],
      "complete",
    );

    expect(result.findingsToResolve).toEqual(["old"]);
    expect(result.findingsToCreate).toEqual([
      expect.objectContaining({ id: "new", resolution: "open" }),
    ]);
  });

  it("preserves active human overrides when the finding disappears", () => {
    store.batchUpsert([
      finding({ id: "waived", resolution: "waived" }),
      finding({ id: "false-positive", resolution: "false-positive" }),
      finding({ id: "accepted", resolution: "accepted-risk" }),
    ]);

    const result = reconcileAndPersistFindings(
      store,
      7,
      "repo",
      [],
      "complete",
    );

    expect(result.findingsToKeep).toEqual([
      "waived",
      "false-positive",
      "accepted",
    ]);
    expect(result.findingsToResolve).toEqual([]);
  });

  it("does not supersede historical resolved or superseded findings", () => {
    store.batchUpsert([
      finding({ id: "resolved-history", resolution: "resolved" }),
      finding({ id: "superseded-history", resolution: "superseded" }),
    ]);
    const current = finding({ id: "current" });

    const result = reconcileAndPersistFindings(
      store,
      7,
      "repo",
      [current],
      "complete",
    );

    expect(result.findingsToSupersede).toEqual([]);
    expect(result.findingsToResolve).toEqual([]);
    expect(result.findingsToCreate).toEqual([
      expect.objectContaining({ id: "current" }),
    ]);
    expect(store.getFindingById("current")?.supersedesFindingId).toBeNull();
  });

  it("persists partial new findings without changing prior state on an incomplete review", () => {
    store.upsertFinding(finding({ id: "prior", contentHash: "prior-hash" }));
    const partial = finding({ id: "partial", contentHash: "partial-hash" });

    const result = reconcileAndPersistFindings(
      store,
      7,
      "repo",
      [partial],
      "incomplete",
    );

    expect(result.findingsToKeep).toEqual(["prior"]);
    expect(result.findingsToResolve).toEqual([]);
    expect(store.getFindingById("prior")?.resolution).toBe("open");
    expect(store.getFindingById("partial")?.resolution).toBe("open");
  });

  it("records the fixing commit hash on resolved findings when headCommitHash is provided", () => {
    const old = finding({ id: "old", blocking: true });
    store.upsertFinding(old);

    reconcileAndPersistFindings(
      store,
      7,
      "repo",
      [],
      "complete",
      "abc123def456",
    );

    expect(store.getFindingById("old")).toMatchObject({
      resolution: "resolved",
      resolvedByCommitHash: "abc123def456",
    });
  });
});

function finding(overrides: Partial<NormalizedFinding> = {}): NormalizedFinding {
  return {
    id: crypto.randomUUID(),
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
    sourceVersion: "test",
    supersedesFindingId: null,
    contentHash: "hash",
    createdAt: "2026-07-20T00:00:00.000Z",
    resolvedAt: null,
    resolvedByCommitHash: null,
    ...overrides,
  };
}
