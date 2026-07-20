import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runPrReviewWorkflow: vi.fn(),
}));

vi.mock("../review/workflows/pr-review-workflow", () => ({
  runPrReviewWorkflow: mocks.runPrReviewWorkflow,
}));

import { ReviewTracker } from "../review/workflows/utils/review-tracker";
import { startReviewPrWithProvider } from "./index";
import { getAgentConfigSessions } from "./session";

afterEach(() => {
  mocks.runPrReviewWorkflow.mockReset();
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
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const provider = { id: "provider" } as never;

    const firstReview = startReviewPrWithProvider(provider, 7);
    await vi.waitFor(() => {
      expect(mocks.runPrReviewWorkflow).toHaveBeenCalledTimes(1);
    });
    await startReviewPrWithProvider(provider, 7);
    releaseFirst?.();
    await firstReview;

    expect(log).toHaveBeenCalledWith(
      "PR Review Workflow Output:",
      { stepId: "new-commit", output: "current" },
    );
    expect(log).not.toHaveBeenCalledWith(
      "PR Review Workflow Output:",
      { stepId: "old-commit", output: "stale" },
    );
  });
});
