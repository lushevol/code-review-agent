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
});
