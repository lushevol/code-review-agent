import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runPrReviewWorkflow: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../review/workflows/pr-review-workflow", () => ({
  runPrReviewWorkflow: mocks.runPrReviewWorkflow,
}));

vi.mock("ratan-logger", () => ({
  getLogger: () => mocks.logger,
}));

import { ReviewTracker } from "../review/workflows/utils/review-tracker";
import { startReviewPrWithProvider } from "./index";
import { getAgentConfigSessions } from "./session";

afterEach(() => {
  mocks.runPrReviewWorkflow.mockReset();
  mocks.logger.info.mockReset();
  mocks.logger.warn.mockReset();
  mocks.logger.error.mockReset();
  getAgentConfigSessions().clearSessions();
  ReviewTracker.cancelAll();
  vi.restoreAllMocks();
});

describe("continued-commit bootstrap reviews", () => {
  it("drops stale workflow output when a newer commit starts for the same PR", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    mocks.runPrReviewWorkflow
      .mockImplementationOnce(async function* () {
        await firstMayFinish;
        yield { stepId: "old-commit", output: "stale" };
      })
      .mockImplementationOnce(async function* () {
        yield { stepId: "new-commit", output: "current" };
      });
    const provider = { id: "provider" } as never;

    const firstReview = startReviewPrWithProvider(provider, 7);
    await vi.waitFor(() => {
      expect(mocks.runPrReviewWorkflow).toHaveBeenCalledTimes(1);
    });
    await startReviewPrWithProvider(provider, 7);
    releaseFirst?.();
    await firstReview;

    expect(mocks.logger.info).toHaveBeenCalledWith(
      "review.step.completed",
      { prId: 7, step: "new-commit" },
    );
    expect(mocks.logger.info).not.toHaveBeenCalledWith(
      "review.step.completed",
      { prId: 7, step: "old-commit" },
    );
    expect(mocks.logger.warn).toHaveBeenCalledWith("review.stale", { prId: 7 });
    expect(mocks.logger.info).toHaveBeenCalledWith("review.started", { prId: 7 });
    expect(mocks.logger.info).toHaveBeenCalledWith(
      "review.finished",
      expect.objectContaining({ prId: 7, status: "complete" }),
    );
  });

  it("marks a degraded review as incomplete", async () => {
    mocks.runPrReviewWorkflow.mockImplementation(async function* () {
      yield {
        stepId: "scanner-pipeline",
        output: { reviewExecutionStatus: "incomplete" },
      };
    });

    await startReviewPrWithProvider({ id: "provider" } as never, 8);

    expect(mocks.logger.info).toHaveBeenCalledWith(
      "review.step.completed",
      { prId: 8, step: "scanner-pipeline", status: "incomplete" },
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      "review.finished",
      expect.objectContaining({ prId: 8, status: "incomplete" }),
    );
  });

  it("logs and rethrows workflow failures", async () => {
    const failure = new Error("workflow failed");
    mocks.runPrReviewWorkflow.mockImplementation(async function* () {
      throw failure;
    });

    await expect(
      startReviewPrWithProvider({ id: "provider" } as never, 9),
    ).rejects.toThrow("workflow failed");

    expect(mocks.logger.error).toHaveBeenCalledWith(
      "review.failed",
      { prId: 9, error: failure },
    );
    expect(mocks.logger.info).not.toHaveBeenCalledWith(
      "review.finished",
      expect.anything(),
    );
  });
});
