import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { repairConfig, repairConfigInteractive } from "./migration";

// ─── Helpers ────────────────────────────────────────────────────────────

const MINIMAL_CONFIG = {
  openCodeReview: {
    rulesPath: "opencodereview/rule.json",
    llm: {
      url: "https://llm.example/v1",
      token: "env:TEST_TOKEN",
      model: "reviewer",
      protocol: "openai",
    },
  },
};

// ─── Tests ──────────────────────────────────────────────────────────────

describe("repairConfig (sync)", () => {
  it("passes through a complete config unchanged", () => {
    const result = repairConfig(MINIMAL_CONFIG);

    expect(result.modified).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it("fills in missing openCodeReview.llm.protocol", () => {
    const config = {
      openCodeReview: {
        rulesPath: "opencodereview/rule.json",
        llm: {
          url: "https://llm.example/v1",
          token: "secret",
          model: "reviewer",
          // no protocol
        },
      },
    };

    const result = repairConfig(config);

    expect(result.modified).toBe(true);
    expect(
      (result.config.openCodeReview as Record<string, unknown>).llm as Record<string, unknown>,
    ).toMatchObject({ protocol: "openai" });
  });

  it("preserves an existing protocol value", () => {
    const config = {
      openCodeReview: {
        rulesPath: "opencodereview/rule.json",
        llm: {
          url: "https://llm.example/v1",
          token: "secret",
          model: "reviewer",
          protocol: "anthropic",
        },
      },
    };

    const result = repairConfig(config);

    expect(result.modified).toBe(false);
    expect(
      (result.config.openCodeReview as Record<string, unknown>).llm as Record<string, unknown>,
    ).toMatchObject({ protocol: "anthropic" });
  });

  it("detects unknown root-level keys", () => {
    const config = {
      ...MINIMAL_CONFIG,
      deprecatedField: "should be warned about",
      anotherOldKey: true,
    };

    const result = repairConfig(config);

    expect(result.warnings.some((w) => w.includes("deprecatedField"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("anotherOldKey"))).toBe(true);
  });

  it("warns about missing required fields", () => {
    const result = repairConfig({});

    // Empty config is missing openCodeReview (required)
    expect(result.warnings.some((w) => w.includes("openCodeReview"))).toBe(true);
  });

  it("preserves all existing fields during repair", () => {
    const config = {
      ado: { organization: "my-org", project: "my-project" },
      logging: { level: "debug" },
      scanRepoNames: ["my-repo"],
      openCodeReview: {
        rulesPath: "opencodereview/rule.json",
        llm: {
          url: "https://llm.example/v1",
          token: "secret",
          model: "reviewer",
        },
      },
      sonarQube: {
        url: "https://sonar.example/api",
        token: "set-your-sonar-token",
      },
    };

    const result = repairConfig(config);

    expect(result.config.ado).toEqual({ organization: "my-org", project: "my-project" });
    expect(result.config.logging).toEqual({ level: "debug" });
    expect(result.config.scanRepoNames).toEqual(["my-repo"]);
    expect(result.config.sonarQube).toEqual({
      url: "https://sonar.example/api",
      token: "set-your-sonar-token",
    });
  });

  it("does not clobber a top-level key that happens to overlap with the shape", () => {
    const config = {
      ...MINIMAL_CONFIG,
      databaseUrl: "sqlite://custom.db",
    };

    const result = repairConfig(config);

    expect(result.config.databaseUrl).toBe("sqlite://custom.db");
    expect(result.warnings.some((w) => w.includes("databaseUrl"))).toBe(false);
  });
});

describe("repairConfigInteractive", () => {
  it("writes repaired config to disk when modified", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ratan-repair-"));
    const configPath = path.join(dir, "config.json");
    const rawConfig = {
      openCodeReview: {
        rulesPath: "opencodereview/rule.json",
        llm: {
          url: "https://llm.example/v1",
          token: "secret",
          model: "reviewer",
        },
      },
    };
    await writeFile(configPath, JSON.stringify(rawConfig), "utf-8");

    // Non-TTY → no prompts, but repair still runs
    const result = await repairConfigInteractive(rawConfig, configPath);

    expect(result.modified).toBe(true);
    // Should have been written to disk
    const written = JSON.parse(await readFile(configPath, "utf-8"));
    expect(
      (written.openCodeReview as Record<string, unknown>).llm as Record<string, unknown>,
    ).toMatchObject({ protocol: "openai" });

    await rm(dir, { recursive: true, force: true });
  });

  it("does not write to disk when nothing changed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ratan-repair-"));
    const configPath = path.join(dir, "config.json");
    await writeFile(configPath, JSON.stringify(MINIMAL_CONFIG), "utf-8");

    const result = await repairConfigInteractive(MINIMAL_CONFIG, configPath);

    expect(result.modified).toBe(false);
    // File unchanged
    const written = JSON.parse(await readFile(configPath, "utf-8"));
    expect(written.openCodeReview).toBeDefined();

    await rm(dir, { recursive: true, force: true });
  });
});
