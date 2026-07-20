import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FindingStore } from "finding-store";
import { getAgentConfigSessions } from "../../../bootstrap/session";
import { RequestContext } from "../../runtime";
import { recordAudit } from "./record-audit";

let tempDir: string | undefined;

afterEach(() => {
  getAgentConfigSessions().clearSessions();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("recordAudit", () => {
  it("persists allowlisted pilot metrics without secret metadata", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "record-audit-"));
    const dbPath = path.join(tempDir, "findings.db");
    const provider = {
      id: "record-audit-test",
      getRootConfig: async () => ({ findingStorePath: dbPath }),
    };
    getAgentConfigSessions().registerProvider(provider as never);
    const requestContext = new RequestContext<{ configSessionId: string }>();
    requestContext.set("configSessionId", provider.id);

    await recordAudit.execute({
      inputData: {
        prDetails: {
          repoName: "repo",
          pullRequestId: 7,
          latestSourceCommitId: "head",
          latestTargetCommitId: "base",
        },
        findings: [],
        correlationSummary: "Summary",
        reviewSummary: "Review summary",
        reviewExecutionStatus: "incomplete",
        reviewMetadata: {
          status: "timeout",
          warningTypes: ["timeout"],
          durationMs: 25,
          filesReviewed: 4,
          reviewFocuses: [
            { focus: "general", reasons: ["Always selected."] },
            { focus: "tests", reasons: ["Production code changed."] },
          ],
          postableFindingCount: 3,
          duplicateSuppressionReasons: {
            contentHashCorrelation: 2,
            inlineContentHash: 0,
            previouslyLinkedThread: 1,
          },
          inlineSuppressionReasons: {
            invalidCodeLocation: 1,
            commentLimit: 0,
          },
          llmToken: "must-not-be-persisted",
        },
        measures: null,
        mergeDecision: "pending",
      },
      requestContext,
    });

    const store = new FindingStore(dbPath);
    store.init();
    const [record] = store.queryAuditRecords({ prId: 7, repository: "repo" });
    expect(record.rawScannerOutputs).toEqual({
      reviewExecutionStatus: "incomplete",
      reviewFocuses: [
        { focus: "general", reasons: ["Always selected."] },
        { focus: "tests", reasons: ["Production code changed."] },
      ],
      ocrStatus: "timeout",
      ocrWarningTypes: ["timeout"],
      ocrDurationMs: 25,
      reviewedFileCount: 4,
      postableFindingCount: 3,
      duplicateSuppressionReasons: {
        contentHashCorrelation: 2,
        inlineContentHash: 0,
        previouslyLinkedThread: 1,
      },
      inlineSuppressionReasons: {
        invalidCodeLocation: 1,
        commentLimit: 0,
      },
      correlationSummary: "Summary",
    });
    expect(JSON.stringify(record.rawScannerOutputs)).not.toContain(
      "must-not-be-persisted",
    );
    store.close();
  });
});
