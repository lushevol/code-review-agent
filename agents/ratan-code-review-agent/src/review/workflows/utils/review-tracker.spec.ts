import { afterEach, describe, expect, it } from "vitest";
import { ReviewTracker } from "./review-tracker";

afterEach(() => ReviewTracker.cancelAll());

describe("continued-commit review tracking", () => {
  it("cancels the in-flight review when a newer commit starts for the same PR", () => {
    const firstCommit = ReviewTracker.startReview(7);
    const nextCommit = ReviewTracker.startReview(7);

    expect(firstCommit.aborted).toBe(true);
    expect(nextCommit.aborted).toBe(false);
    expect(ReviewTracker.isReviewRunning(7)).toBe(true);
  });

  it("does not cancel a review running for another PR", () => {
    const firstPr = ReviewTracker.startReview(7);
    const secondPr = ReviewTracker.startReview(8);

    expect(firstPr.aborted).toBe(false);
    expect(secondPr.aborted).toBe(false);
    expect(ReviewTracker.isReviewRunning(7)).toBe(true);
    expect(ReviewTracker.isReviewRunning(8)).toBe(true);
  });

  it("removes a completed review from the running set", () => {
    const signal = ReviewTracker.startReview(7);

    ReviewTracker.finishReview(7);

    expect(signal.aborted).toBe(false);
    expect(ReviewTracker.isReviewRunning(7)).toBe(false);
  });

  it("does not let an older cancelled review clear the newer review", () => {
    const firstCommit = ReviewTracker.startReview(7);
    const nextCommit = ReviewTracker.startReview(7);

    ReviewTracker.finishReview(7, firstCommit);

    expect(nextCommit.aborted).toBe(false);
    expect(ReviewTracker.isReviewRunning(7)).toBe(true);
  });

  it("cancels every in-flight review during shutdown", () => {
    const first = ReviewTracker.startReview(7);
    const second = ReviewTracker.startReview(8);

    ReviewTracker.cancelAll();

    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(true);
    expect(ReviewTracker.isReviewRunning(7)).toBe(false);
    expect(ReviewTracker.isReviewRunning(8)).toBe(false);
  });
});
