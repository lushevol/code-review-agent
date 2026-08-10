import { afterEach, describe, expect, it, vi } from "vitest";
import { AutoScanService } from "./auto-scan";

describe("AutoScanService LLM health check", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("checks the OpenAI models endpoint with a bearer credential", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 204, statusText: "No Content" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new AutoScanService();
    await expect(
      service.isLLMEndpointHealthy("https://llm.example/v1", "token", "openai"),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://llm.example/v1/models",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer token",
        },
      }),
    );
  });

  it("checks the Anthropic models endpoint with Anthropic headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const service = new AutoScanService();
    await expect(
      service.isLLMEndpointHealthy(
        "https://api.anthropic.com/v1/",
        "token",
        "anthropic",
      ),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models",
      expect.objectContaining({
        headers: {
          "anthropic-version": "2023-06-01",
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
