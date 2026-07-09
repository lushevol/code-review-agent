import { describe, it, expect } from "vitest";
import { LocalConfigClient } from "./local-client";
import path from "node:path";

const FIXTURES_DIR = path.resolve(
  __dirname,
  "../../../test-fixtures/local-config",
);

describe("LocalConfigClient", () => {
  it("reads RootAgentConfig from the config field", async () => {
    const client = new LocalConfigClient({
      configDir: FIXTURES_DIR,
      config: {
        scanRepoNames: ["test-repo"],
        scanPRCreatedDaysAgo: 3,
        agents: {
          review: { prompts: ["prompts/review.md"] },
        },
      },
      ado: { organization: "test-org", project: "test-project" },
      adoToken: "test-token",
    });

    const rootConfig = await client.getRootConfig();
    expect(rootConfig.scanRepoNames).toEqual(["test-repo"]);
    expect(rootConfig.agents.review.prompts).toEqual(["prompts/review.md"]);
  });

  it("reads prompt files from the filesystem", async () => {
    const client = new LocalConfigClient({
      configDir: FIXTURES_DIR,
      config: {
        agents: {
          review: { prompts: ["prompts/review.md"] },
        },
      },
      ado: { organization: "test-org", project: "test-project" },
      adoToken: "test-token",
    });

    const prompt = await client.buildPrompt("review");
    expect(prompt).toContain("review instructions");
  });

  it("returns null ORM client when no connection URL", async () => {
    const client = new LocalConfigClient({
      configDir: FIXTURES_DIR,
      config: { agents: { review: {} } },
      ado: { organization: "o", project: "p" },
      adoToken: "t",
    });
    expect(await client.getOrmClient()).toBeNull();
  });

  it("throws on getAgentConfig for nonexistent agent", async () => {
    const client = new LocalConfigClient({
      configDir: FIXTURES_DIR,
      config: { agents: { review: {} } },
      ado: { organization: "o", project: "p" },
      adoToken: "t",
    });
    await expect(client.getAgentConfig("nonexistent")).rejects.toThrow(
      'Agent "nonexistent" not found in local configuration.',
    );
  });

  it("throws on buildPrompt for nonexistent prompt key", async () => {
    const client = new LocalConfigClient({
      configDir: "/tmp",
      config: { agents: { nonexistent: {} } },
      ado: { organization: "o", project: "p" },
      adoToken: "t",
    });
    await expect(client.buildPrompt("nonexistent")).rejects.toThrow(
      'Prompt key "nonexistent" not found for agent.',
    );
  });

  it("throws on getAdoClient before connect", () => {
    const client = new LocalConfigClient({
      configDir: FIXTURES_DIR,
      config: { agents: { review: {} } },
      ado: { organization: "o", project: "p" },
      adoToken: "t",
    });
    expect(() => client.getAdoClient()).toThrow(
      "ADO client not connected. Call connect() first.",
    );
  });

  it("returns null SonarQube client when no token is configured", () => {
    const client = new LocalConfigClient({
      configDir: FIXTURES_DIR,
      config: { agents: { review: {} } },
      ado: { organization: "o", project: "p" },
      adoToken: "t",
    });
    expect(client.getSonarQubeClient()).toBeNull();
  });

  it("merges defaultAgentConfig with agent config", async () => {
    const client = new LocalConfigClient({
      configDir: FIXTURES_DIR,
      config: {
        defaultAgentConfig: { model: "gpt-4", temperature: 0.1 },
        agents: {
          review: { temperature: 0.5, prompts: ["prompts/review.md"] },
        },
      },
      ado: { organization: "o", project: "p" },
      adoToken: "t",
    });
    const config = await client.getAgentConfig("review");
    expect(config.model).toBe("gpt-4"); // from default
    expect(config.temperature).toBe(0.5); // overridden by agent
    expect(config.prompts).toEqual(["prompts/review.md"]); // from agent
  });

  it("stores the ADO proxy override for connection setup", () => {
    const client = new LocalConfigClient({
      configDir: FIXTURES_DIR,
      config: { agents: { review: {} } },
      ado: { organization: "o", project: "p" },
      adoToken: "t",
      adoProxyUrl: "none",
    });

    expect(
      (client as unknown as { options: { adoProxyUrl?: string } }).options
        .adoProxyUrl,
    ).toBe("none");
  });

  it("throws when configDir is missing in constructor", () => {
    expect(
      () =>
        new LocalConfigClient({
          configDir: "",
          config: { agents: { review: {} } },
          ado: { organization: "o", project: "p" },
          adoToken: "t",
        }),
    ).toThrow("configDir is required");
  });

  it("throws when ado.organization is missing in constructor", () => {
    expect(
      () =>
        new LocalConfigClient({
          configDir: "/tmp",
          config: { agents: { review: {} } },
          ado: { organization: "", project: "p" },
          adoToken: "t",
        }),
    ).toThrow("ado.organization is required");
  });
});
