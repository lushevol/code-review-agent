import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FindingStore } from "finding-store";
import { createDashboardApp } from "./index";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("GET /api/audit", () => {
  it("exports routed review outcome metrics", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dashboard-audit-"));
    tempDirs.push(dir);
    const store = new FindingStore(path.join(dir, "findings.db"));
    await store.init();
    store.saveAuditRecord({
      id: "550e8400-e29b-41d4-a716-446655440000",
      prId: 7,
      repository: "repo",
      commitHash: "head",
      baseCommitHash: "base",
      reviewStartTimestamp: "2026-07-15T00:00:00.000Z",
      reviewEndTimestamp: "2026-07-15T00:01:00.000Z",
      scanners: [
        { engine: "open-code-review", version: "1.7.7", durationMs: 25 },
      ],
      modelVersion: "review-model",
      findingsCount: 3,
      blockingFindingsCount: 0,
      mergePolicyDecision: "pending",
      supersedesReviewId: null,
      rawScannerOutputs: {
        reviewExecutionStatus: "incomplete",
        reviewFocuses: [
          { focus: "general", reasons: ["Always selected."] },
        ],
        ocrStatus: "timeout",
        postableFindingCount: 2,
        duplicateSuppressionReasons: {
          contentHashCorrelation: 1,
          inlineContentHash: 0,
          previouslyLinkedThread: 1,
        },
      },
      createdAt: "2026-07-15T00:01:00.000Z",
    });

    const app = createDashboardApp(store);
    const response = await app.request("/api/audit?prId=7&repo=repo");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      records: Array<{ rawScannerOutputs: Record<string, unknown> }>;
    };
    expect(body.records[0].rawScannerOutputs).toMatchObject({
      reviewExecutionStatus: "incomplete",
      reviewFocuses: [
        { focus: "general", reasons: ["Always selected."] },
      ],
      ocrStatus: "timeout",
      postableFindingCount: 2,
      duplicateSuppressionReasons: {
        contentHashCorrelation: 1,
        previouslyLinkedThread: 1,
      },
    });
    expect(JSON.stringify(body)).not.toMatch(/token|secret/i);
    store.close();
  });
});

describe("dashboard data routes", () => {
  it("returns global findings, overrides, stable stats, and repository-scoped PRs", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dashboard-data-"));
    tempDirs.push(dir);
    const store = new FindingStore(path.join(dir, "findings.db"));
    await store.init();
    const finding = (id: string, repository: string, contentHash: string) => ({
      id,
      prId: 7,
      repository,
      filePath: "src/file.ts",
      lineStart: 1,
      lineEnd: 1,
      category: "bug",
      severity: "high",
      confidence: 0,
      title: "Finding",
      description: "Description",
      evidence: "Evidence",
      businessImpact: "",
      remediation: "Fix",
      blocking: true,
      linkedTaskId: null,
      resolution: "open",
      sourceEngine: "open-code-review",
      sourceVersion: "1.7.7",
      supersedesFindingId: null,
      contentHash,
      createdAt: "2026-07-15T00:00:00.000Z",
      resolvedAt: null,
    });
    store.batchUpsert([
      finding("550e8400-e29b-41d4-a716-446655440010", "repo-a", "hash-a"),
      finding("550e8400-e29b-41d4-a716-446655440011", "repo-b", "hash-b"),
    ]);
    store.updateResolution("550e8400-e29b-41d4-a716-446655440010", "false-positive", {
      overriddenBy: "owner",
      justification: "Expected behavior",
    });
    const saveAudit = (id: string, repository: string, decision: "allowed" | "blocked", started: string) =>
      store.saveAuditRecord({
        id,
        prId: 7,
        repository,
        commitHash: id,
        reviewStartTimestamp: started,
        reviewEndTimestamp: started,
        scanners: [],
        modelVersion: "model",
        findingsCount: 1,
        blockingFindingsCount: decision === "blocked" ? 1 : 0,
        mergePolicyDecision: decision,
        supersedesReviewId: null,
        createdAt: started,
      });
    saveAudit("550e8400-e29b-41d4-a716-446655440020", "repo-a", "blocked", "2026-07-15T00:00:00.000Z");
    saveAudit("550e8400-e29b-41d4-a716-446655440021", "repo-a", "allowed", "2026-07-16T00:00:00.000Z");
    saveAudit("550e8400-e29b-41d4-a716-446655440022", "repo-b", "blocked", "2026-07-17T00:00:00.000Z");

    const app = createDashboardApp(store);
    const get = async (route: string) => {
      const response = await app.request(route);
      expect(response.status).toBe(200);
      return response.json() as Promise<any>;
    };
    expect((await get("/api/findings")).total).toBe(2);
    expect((await get("/api/findings?prId=7&repo=repo-b")).findings).toHaveLength(1);
    expect((await app.request("/api/findings?engine=legacy")).status).toBe(400);
    expect((await app.request("/api/findings?status=wont-fix")).status).toBe(400);
    expect((await app.request("/api/findings/550e8400-e29b-41d4-a716-446655440011", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resolution: "wont-fix", overriddenBy: "owner" }),
    })).status).toBe(400);
    expect((await get("/api/overrides")).overrides[0]).toMatchObject({
      overriddenBy: "owner",
      newResolution: "false-positive",
    });
    expect(await get("/api/stats")).toMatchObject({
      totalReviews: 3,
      totalPRs: 2,
      totalFindings: 2,
    });
    const prs = await get("/api/prs");
    expect(prs.total).toBe(2);
    expect(prs.prs).toEqual(expect.arrayContaining([
      expect.objectContaining({ repository: "repo-a", status: "allowed", findingCount: 1 }),
      expect.objectContaining({ repository: "repo-b", status: "blocked", findingCount: 1 }),
    ]));
    store.close();
  });
});
