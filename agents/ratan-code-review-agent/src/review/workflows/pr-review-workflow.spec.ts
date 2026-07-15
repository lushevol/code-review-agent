import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runSteps: vi.fn(),
  sonarqubeExecute: vi.fn(),
}));

vi.mock("../runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime")>()),
  runSteps: mocks.runSteps,
}));

vi.mock("../workspace/local-review-workspace", () => ({
  LocalReviewWorkspaceProvider: class {
    async withWorkspace(
      _metadata: unknown,
      callback: (workspace: unknown) => Promise<unknown>,
    ) {
      return callback({
        repoPath: "/tmp/repo",
        runDirectory: "/tmp/run",
        mergeBaseCommit: "base",
        headCommit: "head",
        changes: [
          {
            path: "src/file.ts",
            status: "modified",
            addedLines: [{ line: 1, text: "try { return fallback ?? value; }" }],
          },
        ],
      });
    }
  },
}));

vi.mock("../../bootstrap/session", () => ({
  extractAgentConfig: () => ({
    getRootConfig: async () => ({
      openCodeReview: { workspaceRoot: "/tmp/workspaces" },
    }),
    getAdoClient: () => ({ getAdoToken: () => "token" }),
  }),
}));

vi.mock("./steps/sonarqube-measures", () => ({
  sonarqubeMeasures: {
    id: "sonarqube-measures",
    execute: mocks.sonarqubeExecute,
  },
}));

import { RequestContext } from "../runtime";
import { runPrReviewWorkflow } from "./pr-review-workflow";

describe("runPrReviewWorkflow", () => {
  beforeEach(() => {
    mocks.runSteps.mockReset();
    mocks.sonarqubeExecute.mockReset().mockResolvedValue({ measures: null });
  });

  it("retains selected focuses and elapsed time when scanner execution throws", async () => {
    mocks.runSteps.mockImplementation(async (steps, inputData) => {
      if (steps[0]?.id === "fetch-pr-details") {
        return {
          prDetails: {
            repoId: "repo-id",
            repoName: "repo",
            pullRequestId: 7,
            latestTargetCommitId: "base",
            latestSourceCommitId: "head",
          },
          workItemContext: "",
        };
      }
      if (steps[0]?.id === "scanner-pipeline") {
        throw new Error("OCR output contract failed");
      }
      return inputData;
    });

    const events = [];
    for await (const event of runPrReviewWorkflow({
      inputData: { prId: 7 },
      requestContext: new RequestContext(),
    })) {
      events.push(event);
    }

    const scannerEvent = events.find(
      ({ stepId }) => stepId === "scanner-pipeline",
    );
    expect(scannerEvent?.output).toMatchObject({
      reviewExecutionStatus: "incomplete",
      reviewMetadata: {
        status: "failed",
        reviewFocuses: [
          { focus: "general" },
          { focus: "tests" },
          { focus: "error-handling" },
        ],
      },
    });
    expect(
      (scannerEvent?.output as { reviewMetadata: { durationMs: number } })
        .reviewMetadata.durationMs,
    ).toBeGreaterThan(0);
  });
});
