import { once } from "node:events";
import type { AddressInfo } from "node:net";
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
    store.init();
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

    const server = createDashboardApp(store).listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${port}/api/audit?prId=7&repo=repo`,
      );
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
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      store.close();
    }
  });
});
