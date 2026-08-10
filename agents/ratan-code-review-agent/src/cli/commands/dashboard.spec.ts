import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDashboardApp: vi.fn(() => ({ fetch: vi.fn() })),
  initStore: vi.fn().mockResolvedValue(undefined),
  loadConfig: vi.fn(),
  serve: vi.fn(),
}));

vi.mock("finding-store", () => ({
  FindingStore: class {
    init = mocks.initStore;
    close = vi.fn();
  },
}));
vi.mock("@hono/node-server", () => ({ serve: mocks.serve }));
vi.mock("../config/loader", () => ({ loadConfig: mocks.loadConfig }));
vi.mock("../dashboard", () => ({
  createDashboardApp: mocks.createDashboardApp,
}));
vi.mock("../utils/logger", () => ({
  getLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

import { startDashboard } from "./dashboard";

describe("startDashboard", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("rejects a non-loopback host without authentication before opening the store", async () => {
    mocks.loadConfig.mockResolvedValue({
      provider: {
        getRootConfig: vi.fn().mockResolvedValue({
          dashboard: { host: "0.0.0.0" },
        }),
      },
    });

    await expect(startDashboard({})).rejects.toThrow(
      "Dashboard authentication is required",
    );

    expect(mocks.initStore).not.toHaveBeenCalled();
    expect(mocks.serve).not.toHaveBeenCalled();
  });
});
