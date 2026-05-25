import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCliArgs } from "./cli-options";

describe("parseCliArgs", () => {
  it("builds startup options from environment variables for ADO review runs", () => {
    const parsed = parseCliArgs(["run"], {
      ADO_TOKEN: "ado-token",
      ADO_ORGANIZATION: "ado-org",
      ADO_PROJECT: "ado-project",
      ADO_CONFIG_REPO: "agent-config",
      ADO_CONFIG_BRANCH: "main",
      ADO_CONFIG_BASE_PATH: "configs/review",
      ADO_PROXY_URL: "http://proxy.example:8080",
      SONARQUBE_TOKEN: "sonar-token",
      DATABASE_URL: "postgres://example",
    });

    expect(parsed).toEqual({
      command: "run",
      options: {
        adoToken: "ado-token",
        organization: "ado-org",
        project: "ado-project",
        repoName: "agent-config",
        branch: "main",
        basePath: "configs/review",
        adoProxyUrl: "http://proxy.example:8080",
        sonarQubeToken: "sonar-token",
        ormConnectionUrl: "postgres://example",
      },
    });
  });

  it("builds config options for read-only ADO doctor checks", () => {
    const parsed = parseCliArgs(["doctor"], {
      ADO_TOKEN: "ado-token",
      ADO_CONFIG_REPO: "agent-config",
      ADO_CONFIG_BRANCH: "main",
    });

    expect(parsed).toEqual({
      command: "doctor",
      options: {
        adoToken: "ado-token",
        repoName: "agent-config",
        branch: "main",
      },
    });
  });

  it("lets command-line flags override environment defaults", () => {
    const parsed = parseCliArgs(
      [
        "run",
        "--ado-token",
        "flag-token",
        "--config-repo",
        "flag-config",
        "--config-branch",
        "release",
        "--refresh-interval-ms",
        "1000",
        "--ado-proxy-url",
        "none",
      ],
      {
        ADO_TOKEN: "env-token",
        ADO_CONFIG_REPO: "env-config",
        ADO_CONFIG_BRANCH: "main",
      },
    );

    expect(parsed).toMatchObject({
      command: "run",
      options: {
        adoToken: "flag-token",
        repoName: "flag-config",
        branch: "release",
        refreshIntervalMs: 1000,
        adoProxyUrl: "none",
      },
    });
  });

  it("reports missing required ADO configuration before startup", () => {
    expect(() => parseCliArgs(["run"], {})).toThrow(
      "Missing required configuration: ADO_TOKEN, ADO_CONFIG_REPO, ADO_CONFIG_BRANCH",
    );
  });

  it("reports help without requiring ADO credentials", () => {
    expect(parseCliArgs(["--help"], {})).toEqual({ command: "help" });
    expect(parseCliArgs([], {})).toEqual({ command: "help" });
  });
});

describe("package CLI manifest", () => {
  const repoRoot = join(import.meta.dirname, "../../..");
  const packageJson = JSON.parse(
    readFileSync(join(import.meta.dirname, "../package.json"), "utf8"),
  );

  it("is publishable as an npm CLI package", () => {
    expect(packageJson.private).not.toBe(true);
    expect(packageJson.bin).toEqual({
      "ratan-code-review-agent": "./dist/cli.js",
    });
    expect(packageJson.types).toBeUndefined();
    expect(packageJson.exports["."].types).toBeUndefined();
    expect(packageJson.files).toContain("dist");
  });

  it("uses cross-platform npm scripts", () => {
    expect(packageJson.scripts.build).toContain("cross-env NODE_OPTIONS=");
    expect(packageJson.scripts.start).not.toContain("instrumentation.mjs");
  });

  it("does not depend on private workspace packages for publish", () => {
    const workspacePackagePaths = [
      "packages/agent-config-manager/package.json",
      "packages/ratan-ado-api/package.json",
      "packages/ratan-code-review-agent-orm/package.json",
      "packages/ratan-markdown-tool/package.json",
      "packages/ratan-sonarqube-api/package.json",
    ];

    for (const packagePath of workspacePackagePaths) {
      const workspacePackage = JSON.parse(
        readFileSync(join(repoRoot, packagePath), "utf8"),
      );
      expect(workspacePackage.private, packagePath).not.toBe(true);
    }
  });
});
