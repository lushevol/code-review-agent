import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createWebhookServer: vi.fn(() => ({ fetch: vi.fn() })),
  order: [] as string[],
  serve: vi.fn(),
}));

vi.mock("@hono/node-server", () => ({ serve: mocks.serve }));
vi.mock("../../webhooks", () => ({
  createWebhookServer: mocks.createWebhookServer,
}));

import { startWebhookService } from "./webhook";

describe("startWebhookService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    mocks.order.length = 0;
  });

  it("registers both signals and shuts down once in listener-first order", async () => {
    const signalHandlers = new Map<string, () => void>();
    vi.spyOn(process, "once").mockImplementation((event, listener) => {
      signalHandlers.set(String(event), listener as () => void);
      return process;
    });
    vi.spyOn(process, "off").mockImplementation(() => process);
    mocks.serve.mockReturnValue({
      close: (callback: (error?: Error) => void) => {
        mocks.order.push("listener");
        callback();
      },
    });
    const findingStore = {
      close: vi.fn(() => {
        mocks.order.push("store");
      }),
    };

    const service = await startWebhookService({
      adoClient: {},
      findingStore: findingStore as never,
      onReview: vi.fn(),
      port: 3098,
    });
    const firstShutdown = service.shutdown();
    const secondShutdown = service.shutdown();

    expect(signalHandlers.has("SIGTERM")).toBe(true);
    expect(signalHandlers.has("SIGINT")).toBe(true);
    expect(secondShutdown).toBe(firstShutdown);
    await firstShutdown;
    expect(mocks.order).toEqual(["listener", "store"]);
    expect(findingStore.close).toHaveBeenCalledOnce();
  });
});
