import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "./loader";
import { ensureRatanFolder } from "../commands/start";

describe("ratan config scaffold", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("creates a loadable local wrapper config with a native OCR rule file", async () => {
    vi.stubEnv("OCR_LLM_URL", "https://llm.example/v1");
    vi.stubEnv("OCR_LLM_TOKEN", "secret");
    const dir = await mkdtemp(path.join(tmpdir(), "ratan-scaffold-"));
    try {
      const ratanDir = ensureRatanFolder(path.join(dir, ".ratan"));

      const { provider } = await loadConfig(ratanDir);
      const rootConfig = await provider.getRootConfig();

      expect(rootConfig.findingStorePath).toBe(".ratan/data/findings.db");
      expect(rootConfig.openCodeReview).toMatchObject({
        rulesPath: "opencodereview/rule.json",
        llm: { model: "your-review-model" },
      });
      await expect(readFile(path.join(ratanDir, "opencodereview/rule.json"), "utf8"))
        .resolves.toContain('"rules"');
      expect(existsSync(path.join(ratanDir, "prompts"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
