/**
 * ReviewTracker — tracks running reviews by PR ID so in-flight
 * reviews can be cancelled when a new commit is pushed.
 */
export class ReviewTracker {
  private static runningReviews = new Map<number, AbortController>();

  /**
   * Start tracking a review for the given PR.
   * If a review is already running for this PR, it is cancelled first.
   * Returns an AbortSignal that callers can check/use.
   */
  static startReview(prId: number): AbortSignal {
    if (this.runningReviews.has(prId)) {
      this.runningReviews.get(prId)!.abort();
      console.log(`[ReviewTracker] Cancelled in-flight review for PR #${prId}`);
    }
    const controller = new AbortController();
    this.runningReviews.set(prId, controller);
    return controller.signal;
  }

  /**
   * Mark a review as finished for the given PR.
   */
  static finishReview(prId: number, signal?: AbortSignal): void {
    if (signal && this.runningReviews.get(prId)?.signal !== signal) return;
    this.runningReviews.delete(prId);
  }

  /**
   * Check if a review is currently running for the given PR.
   */
  static isReviewRunning(prId: number): boolean {
    return this.runningReviews.has(prId);
  }

  /**
   * Cancel all running reviews (e.g., on shutdown).
   */
  static cancelAll(): void {
    for (const [prId, controller] of this.runningReviews) {
      controller.abort();
      console.log(`[ReviewTracker] Cancelled review for PR #${prId} (shutdown)`);
    }
    this.runningReviews.clear();
  }
}
