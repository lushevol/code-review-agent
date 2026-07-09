import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./loader";
import { ensureRatanFolder } from "../commands/start";

describe("ratan config scaffold", () => {
  it("creates a loadable local wrapper config with all prompt keys", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ratan-scaffold-"));
    try {
      const ratanDir = ensureRatanFolder(path.join(dir, ".ratan"));

      const { provider } = await loadConfig(ratanDir);
      const rootConfig = await provider.getRootConfig();

      expect(rootConfig.findingStorePath).toBe(".ratan/data/findings.db");
      await expect(provider.getAgentConfig("review")).resolves.toBeDefined();
      await expect(provider.getAgentConfig("review-rescore")).resolves.toBeDefined();
      await expect(provider.getAgentConfig("issue-classification")).resolves.toBeDefined();
      await expect(provider.getAgentConfig("summary")).resolves.toBeDefined();
      await expect(provider.buildPrompt("summary")).resolves.toContain("summarize");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
