import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { LocalConfigClient } from "./local-client";
import { SonarQubeClient } from "ratan-sonarqube-api";

const config = {
  ado: { organization: "o", project: "p", proxyUrl: "" },
  logging: {
    level: "debug" as const,
    directory: ".ratan/logs",
    retentionDays: 14,
  },
  retry: {
    maxAttempts: 4,
    baseDelayMs: 50,
    maxDelayMs: 500,
    jitterMs: 0,
  },
  sonarQube: {
    url: "https://sonar.example/api",
    token: "token",
  },
  openCodeReview: {
    rulesPath: "opencodereview/rule.json",
    llm: {
      url: "https://llm.example/v1",
      token: "secret",
      model: "model",
    },
  },
};

describe("LocalConfigClient", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns the OpenCodeReview root configuration", async () => {
    const client = new LocalConfigClient({
      configDir: "/tmp/ratan",
      config,
    });

    expect((await client.getRootConfig()).openCodeReview.llm.model).toBe("model");
  });

  it("resolves rule paths relative to the .ratan directory", () => {
    const client = new LocalConfigClient({
      configDir: "/tmp/ratan",
      config,
    });

    expect(client.resolveConfigPath("opencodereview/rule.json")).toBe(
      path.resolve("/tmp/ratan", "opencodereview/rule.json"),
    );
  });

  it("throws on getAdoClient before connect", () => {
    const client = new LocalConfigClient({
      configDir: "/tmp/ratan",
      config,
    });

    expect(() => client.getAdoClient()).toThrow(
      "ADO client not connected. Ensure config has ado.organization, ado.project, and ado.token.",
    );
  });

  it("uses the root SonarQube and retry settings", async () => {
    vi.spyOn(SonarQubeClient.prototype, "connect").mockResolvedValue(false);
    const client = new LocalConfigClient({
      configDir: "/tmp/ratan",
      config,
    });

    await client.connect();

    expect(client.getSonarQubeClient()).toBeNull();
    expect(SonarQubeClient.prototype.connect).toHaveBeenCalledWith("token");
  });
});
