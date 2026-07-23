import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasBuildPipeline: vi.fn(),
  loadConfig: vi.fn(),
  processor: undefined as
    | ((item: { prId: number; repoName: string }) => Promise<void>)
    | undefined,
  scan: vi.fn(),
  setRepoPatterns: vi.fn(),
  startReviewPrWithProvider: vi.fn(),
  checkReadiness: vi.fn().mockResolvedValue({
    results: [],
    criticalFailures: [],
    allOk: true,
  }),
}));

vi.mock("../config/loader", () => ({ loadConfig: mocks.loadConfig }));
vi.mock("../../bootstrap", () => ({
  startReviewPrWithProvider: mocks.startReviewPrWithProvider,
}));
vi.mock("../readiness/readiness-check", () => ({
  checkReadiness: mocks.checkReadiness,
  printReadinessReport: vi.fn(),
}));
vi.mock("../utils/logger", () => ({
  cleanOldLogs: vi.fn(),
  configureLogging: vi.fn(),
  getLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
  installConsoleCapture: vi.fn(),
}));
vi.mock("../services/pr-queue", () => ({
  getPRQueue: () => {
    return {
      setProcessor: (next: typeof mocks.processor) => {
        mocks.processor = next;
      },
      hasBuildPipeline: mocks.hasBuildPipeline,
      enqueue: (item: { prId: number; repoName: string }) => {
        void mocks.processor?.(item);
      },
      pendingCount: 0,
      currentProcessing: null,
    };
  },
}));
vi.mock("../services/auto-scan", () => ({
  getAutoScanService: () => ({
    scan: mocks.scan,
    setRepoPatterns: mocks.setRepoPatterns,
  }),
}));

import { startCommand } from "./start";

describe("startCommand", () => {
  afterEach(() => {
    vi.resetAllMocks();
    mocks.processor = undefined;
    // Restore the default readiness-check mock after reset
    mocks.checkReadiness.mockResolvedValue({
      results: [],
      criticalFailures: [],
      allOk: true,
    });
  });

  it("reviews an explicitly requested PR without requiring a build status", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ratan-start-"));
    const provider = {
      connect: vi.fn(),
      getRootConfig: vi.fn().mockResolvedValue({}),
    };
    mocks.loadConfig.mockResolvedValue({ provider });
    mocks.hasBuildPipeline.mockResolvedValue(false);
    mocks.startReviewPrWithProvider.mockResolvedValue(undefined);

    try {
      await startCommand({ config: path.join(dir, ".ratan"), prId: 4 });

      expect(mocks.startReviewPrWithProvider).toHaveBeenCalledWith(provider, 4);
      expect(mocks.hasBuildPipeline).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("propagates an explicitly requested PR review failure", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ratan-start-"));
    const provider = {
      connect: vi.fn(),
      getRootConfig: vi.fn().mockResolvedValue({}),
    };
    mocks.loadConfig.mockResolvedValue({ provider });
    mocks.startReviewPrWithProvider.mockRejectedValue(new Error("review failed"));

    try {
      await expect(
        startCommand({ config: path.join(dir, ".ratan"), prId: 4 }),
      ).rejects.toThrow("review failed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps the build-status gate for automatically scanned PRs", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ratan-start-"));
    const provider = {
      connect: vi.fn(),
      getRootConfig: vi.fn().mockResolvedValue({}),
    };
    mocks.loadConfig.mockResolvedValue({ provider });
    mocks.hasBuildPipeline.mockResolvedValue(false);
    mocks.scan.mockImplementation(async () => {
      await mocks.processor?.({ prId: 5, repoName: "repo" });
      return 1;
    });

    try {
      await startCommand({ config: path.join(dir, ".ratan") });

      expect(mocks.hasBuildPipeline).toHaveBeenCalledWith(provider, 5, "repo");
      expect(mocks.startReviewPrWithProvider).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("applies command-line repository patterns to automatic scans", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ratan-start-"));
    const provider = {
      connect: vi.fn(),
      getRootConfig: vi.fn().mockResolvedValue({}),
    };
    mocks.loadConfig.mockResolvedValue({ provider });
    mocks.scan.mockResolvedValue(0);

    try {
      await startCommand({
        config: path.join(dir, ".ratan"),
        repoPatterns: ["api-*", "web"],
      });

      expect(mocks.setRepoPatterns).toHaveBeenCalledWith(["api-*", "web"]);
      expect(mocks.scan).toHaveBeenCalledWith(provider);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
