import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import initSqlJs from "sql.js";
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
  it("rejects a database created by a newer schema version", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "finding-store-"));
    const dbPath = path.join(dir, "findings.db");
    const SQL = await initSqlJs();
    const futureDatabase = new SQL.Database();
    futureDatabase.run("PRAGMA user_version=999");
    await writeFile(dbPath, Buffer.from(futureDatabase.export()));
    futureDatabase.close();

    const store = new FindingStore(dbPath);
    try {
      await expect(store.init()).rejects.toThrow(
        "schema version 999 is newer than supported version 1",
      );
    } finally {
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("upgrades an unversioned database without losing existing findings", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "finding-store-"));
    const dbPath = path.join(dir, "findings.db");
    const legacyStore = new FindingStore(dbPath);
    await legacyStore.init();
    legacyStore.upsertFinding(createFinding(null));
    legacyStore.close();

    const SQL = await initSqlJs();
    const legacyDatabase = new SQL.Database(await readFile(dbPath));
    legacyDatabase.run("DROP TABLE review_metrics");
    legacyDatabase.run("PRAGMA user_version=0");
    await writeFile(dbPath, Buffer.from(legacyDatabase.export()));
    legacyDatabase.close();

    const store = new FindingStore(dbPath);
    try {
      await store.init();
      expect(store.getFindingsByPr(7, "repo")).toEqual([
        expect.objectContaining({ id: createFinding(null).id }),
      ]);
      store.saveMetrics({
        id: "550e8400-e29b-41d4-a716-446655440099",
        prId: 7,
        repository: "repo",
        auditRecordId: null,
        totalFindings: 1,
        resolvedFindings: 0,
        validFindingCount: 0,
        falsePositiveCount: 0,
        pendingFeedbackCount: 1,
        cveFindings: 0,
        cveCritical: 0,
        coverageBelowThreshold: 0,
        hadCoverageData: 0,
        resolutionRate: 0,
        validRate: null,
        computedAt: "2026-08-10T00:00:00.000Z",
      });
      expect(store.queryMetrics(7, "repo")).toHaveLength(1);
      store.close();

      const reopenedStore = new FindingStore(dbPath);
      try {
        await reopenedStore.init();
        expect(reopenedStore.getFindingsByPr(7, "repo")).toEqual([
          expect.objectContaining({ id: createFinding(null).id }),
        ]);
        expect(reopenedStore.queryMetrics(7, "repo")).toHaveLength(1);

        const reopenedDatabase = new SQL.Database(await readFile(dbPath));
        const versionResult = reopenedDatabase.exec("PRAGMA user_version");
        expect(versionResult[0]?.values[0]?.[0]).toBe(1);
        reopenedDatabase.close();
      } finally {
        reopenedStore.close();
      }
    } finally {
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stores OCR findings without a confidence score", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "finding-store-"));
    const store = new FindingStore(path.join(dir, "findings.db"));
    try {
      await store.init();
      const finding = createFinding(null) as ReturnType<typeof createFinding> & {
        confidence?: number;
      };
      delete finding.confidence;
      finding.sourceEngine = "open-code-review";

      store.upsertFinding(finding);

      expect(store.getFindingsByPr(7, "repo")[0].confidence).toBe(0);
    } finally {
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("updates linkedTaskId when an existing finding is upserted", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "finding-store-"));
    const store = new FindingStore(path.join(dir, "findings.db"));
    try {
      await store.init();
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

  it("queries findings across repositories for dashboard views", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "finding-store-"));
    const store = new FindingStore(path.join(dir, "findings.db"));
    try {
      await store.init();
      store.batchUpsert([
        createFinding(null),
        {
          ...createFinding(null),
          id: "550e8400-e29b-41d4-a716-446655440002",
          prId: 8,
          repository: "other-repo",
          sourceEngine: "compliance",
          contentHash: "other-hash",
        },
      ]);

      expect(store.queryFindings({})).toHaveLength(2);
      expect(store.queryFindings({ engine: "compliance" })).toEqual([
        expect.objectContaining({ prId: 8, repository: "other-repo" }),
      ]);
    } finally {
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("queries recorded override actions", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "finding-store-"));
    const store = new FindingStore(path.join(dir, "findings.db"));
    try {
      await store.init();
      store.upsertFinding(createFinding(null));
      store.updateResolution(createFinding(null).id, "false-positive", {
        overriddenBy: "reviewer@example.invalid",
        justification: "Confirmed by owner",
      });

      expect(store.queryOverrideLog()).toEqual([
        expect.objectContaining({
          findingId: createFinding(null).id,
          overriddenBy: "reviewer@example.invalid",
          newResolution: "false-positive",
          justification: "Confirmed by owner",
        }),
      ]);
    } finally {
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
