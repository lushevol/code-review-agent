import { afterEach, describe, expect, it, vi } from "vitest";
import { AutoScanService } from "./auto-scan";

describe("AutoScanService LLM health check", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("checks the configured endpoint with its configured credential", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 204, statusText: "No Content" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new AutoScanService();
    await expect(
      service.isLLMEndpointHealthy("https://llm.example/anthropic", "token"),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://llm.example/anthropic",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer token",
          "x-api-key": "token",
        },
      }),
    );
  });

  it("rejects an invalid credential response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );

    const service = new AutoScanService();
    await expect(
      service.isLLMEndpointHealthy("https://llm.example/v1", "bad-token"),
    ).resolves.toBe(false);
  });
});
