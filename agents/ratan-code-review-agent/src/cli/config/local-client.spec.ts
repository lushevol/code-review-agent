import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { LocalConfigClient } from "./local-client";
import { SonarQubeClient } from "ratan-sonarqube-api";

const config = {
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
      ado: { organization: "test-org", project: "test-project" },
    });

    expect((await client.getRootConfig()).openCodeReview.llm.model).toBe("model");
  });

  it("resolves rule paths relative to the .ratan directory", () => {
    const client = new LocalConfigClient({
      configDir: "/tmp/ratan",
      config,
      ado: { organization: "test-org", project: "test-project" },
    });

    expect(client.resolveConfigPath("opencodereview/rule.json")).toBe(
      path.resolve("/tmp/ratan", "opencodereview/rule.json"),
    );
  });

  it("throws on getAdoClient before connect", () => {
    const client = new LocalConfigClient({
      configDir: "/tmp/ratan",
      config,
      ado: { organization: "o", project: "p" },
    });

    expect(() => client.getAdoClient()).toThrow(
      "ADO client not connected. Call connect() first.",
    );
  });

  it("skips Sonar validation when the connection cannot be established", async () => {
    vi.spyOn(SonarQubeClient.prototype, "connect").mockResolvedValue(false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = new LocalConfigClient({
      configDir: "/tmp/ratan",
      config,
      ado: { organization: "o", project: "p" },
      sonarQubeToken: "token",
    });

    await client.connect();

    expect(client.getSonarQubeClient()).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "[config] SonarQube connection unavailable; skipping Sonar validation.",
    );
  });
});
