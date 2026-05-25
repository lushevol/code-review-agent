import { describe, expect, it, vi } from "vitest";
import { runCli } from "./cli-runner";

describe("runCli", () => {
  it("prints help without loading or starting the agent", async () => {
    const startAgent = vi.fn();
    const stdout = vi.fn();
    const stderr = vi.fn();

    const exitCode = await runCli({
      argv: ["--help"],
      env: {},
      startAgent,
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    expect(startAgent).not.toHaveBeenCalled();
    expect(stdout.mock.calls.join("\n")).toContain(
      "ratan-code-review-agent run",
    );
    expect(stderr).not.toHaveBeenCalled();
  });

  it("starts the ADO review agent for the run command", async () => {
    const startAgent = vi.fn().mockResolvedValue(undefined);
    const checkConfig = vi.fn().mockResolvedValue(undefined);

    const exitCode = await runCli({
      argv: ["run"],
      env: {
        ADO_TOKEN: "ado-token",
        ADO_CONFIG_REPO: "agent-config",
        ADO_CONFIG_BRANCH: "main",
      },
      startAgent,
      checkConfig,
      stdout: vi.fn(),
      stderr: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(startAgent).toHaveBeenCalledWith({
      adoToken: "ado-token",
      repoName: "agent-config",
      branch: "main",
    });
    expect(checkConfig).not.toHaveBeenCalled();
  });

  it("checks ADO config without starting review for the doctor command", async () => {
    const startAgent = vi.fn();
    const checkConfig = vi.fn().mockResolvedValue(undefined);
    const stdout = vi.fn();

    const exitCode = await runCli({
      argv: ["doctor"],
      env: {
        ADO_TOKEN: "ado-token",
        ADO_CONFIG_REPO: "agent-config",
        ADO_CONFIG_BRANCH: "main",
      },
      startAgent,
      checkConfig,
      stdout,
      stderr: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(startAgent).not.toHaveBeenCalled();
    expect(checkConfig).toHaveBeenCalledWith({
      adoToken: "ado-token",
      repoName: "agent-config",
      branch: "main",
    });
    expect(stdout.mock.calls.join("\n")).toContain("ADO config check passed");
  });

  it("reports doctor failures without printing generic usage help", async () => {
    const stderr = vi.fn();

    const exitCode = await runCli({
      argv: ["doctor"],
      env: {
        ADO_TOKEN: "ado-token",
        ADO_CONFIG_REPO: "agent-config",
        ADO_CONFIG_BRANCH: "main",
      },
      startAgent: vi.fn(),
      checkConfig: vi.fn().mockRejectedValue(new Error("config.json missing")),
      stdout: vi.fn(),
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stderr.mock.calls.join("\n")).toContain(
      "ADO config check failed: config.json missing",
    );
    expect(stderr.mock.calls.join("\n")).not.toContain("Usage:");
  });

  it("returns a non-zero exit code for invalid configuration", async () => {
    const stderr = vi.fn();

    const exitCode = await runCli({
      argv: ["run"],
      env: {},
      startAgent: vi.fn(),
      stdout: vi.fn(),
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stderr.mock.calls.join("\n")).toContain(
      "Missing required configuration",
    );
  });
});
