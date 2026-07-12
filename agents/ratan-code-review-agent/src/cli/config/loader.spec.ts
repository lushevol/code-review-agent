import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "./loader";

const directories: string[] = [];

async function writeConfig(config: unknown) {
  const directory = await mkdtemp(path.join(tmpdir(), "ratan-config-"));
  directories.push(directory);
  await writeFile(path.join(directory, "config.json"), JSON.stringify(config));
  return directory;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("loadConfig", () => {
  it("resolves nested OpenCodeReview LLM environment references", async () => {
    vi.stubEnv("OCR_LLM_TOKEN", "secret");
    const directory = await writeConfig({
      mode: "local",
      ado: { organization: "org", project: "project" },
      config: {
        openCodeReview: {
          rulesPath: "opencodereview/rule.json",
          llm: {
            url: "https://llm.example/v1",
            token: "env:OCR_LLM_TOKEN",
            model: "model",
          },
        },
      },
    });

    const { provider } = await loadConfig(directory);
    expect((await provider.getRootConfig()).openCodeReview?.llm.token).toBe("secret");
  });

  it("rejects legacy agent configuration", async () => {
    const directory = await writeConfig({
      mode: "local",
      ado: { organization: "org", project: "project" },
      config: { agents: {} },
    });

    await expect(loadConfig(directory)).rejects.toThrow(
      "Legacy config.agents is no longer supported",
    );
  });

  it("resolves nested secret references and validates operational settings", async () => {
    vi.stubEnv("ADO_TOKEN", "ado-token");
    vi.stubEnv("SONAR_TOKEN", "sonar-token");
    vi.stubEnv("OCR_TOKEN", "ocr-token");
    const dir = await writeConfig({
      mode: "local",
      ado: { organization: "org", project: "project", token: "env:ADO_TOKEN" },
      config: {
        logging: { level: "debug", retentionDays: 7 },
        retry: { maxAttempts: 2, baseDelayMs: 10, maxDelayMs: 20, jitterMs: 0 },
        sonarQube: { url: "https://sonar.example/api", token: "env:SONAR_TOKEN" },
        openCodeReview: {
          rulesPath: "opencodereview/rule.json",
          llm: { url: "https://llm.example/v1", token: "env:OCR_TOKEN", model: "reviewer" },
        },
      },
    });

    const { provider } = await loadConfig(dir);
    const config = await provider.getRootConfig();
    expect(config.sonarQube?.token).toBe("sonar-token");
    expect(config.retry?.maxAttempts).toBe(2);
    expect(config.logging?.retentionDays).toBe(7);
  });
});
