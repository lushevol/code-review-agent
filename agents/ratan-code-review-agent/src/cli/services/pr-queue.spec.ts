import { describe, expect, it, vi } from "vitest";
import { PRQueueService } from "./pr-queue";

describe("PRQueueService", () => {
  it("clears pending queue items without cancelling the current processor", async () => {
    const queue = new PRQueueService();
    let releaseCurrent!: () => void;
    const currentStarted = new Promise<void>((resolve) => {
      queue.setProcessor(
        vi.fn(
          () =>
            new Promise<void>((resolveCurrent) => {
              releaseCurrent = resolveCurrent;
              resolve();
            }),
        ),
      );
    });

    queue.enqueue({ prId: 1, repoName: "repo" });
    await currentStarted;
    queue.enqueue({ prId: 2, repoName: "repo" });
    queue.enqueue({ prId: 3, repoName: "repo" });

    expect(queue.pendingCount).toBe(2);
    expect(queue.clearPending()).toBe(2);
    expect(queue.pendingCount).toBe(0);
    expect(queue.currentProcessing).toBe(1);

    releaseCurrent();
  });
});
