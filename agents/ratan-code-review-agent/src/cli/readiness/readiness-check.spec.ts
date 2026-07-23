import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigProvider, RootAgentConfig } from "agent-config-manager";

// Mock execFile so tests can control the OCR binary llm test result
// without needing a real OCR binary installed.
const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

// Module under test — imported after mocks are hoisted
const { checkReadiness } = await import("./readiness-check");

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockProvider(opts: {
  adoConnected?: boolean;
  sonarConnected?: boolean;
} = {}): ConfigProvider {
  const { adoConnected = true, sonarConnected = false } = opts;

  return {
    id: "test",
    connect: vi.fn(),
    getRootConfig: vi.fn(),
    resolveConfigPath: vi.fn(),
    getAdoClient: vi.fn().mockImplementation(() => {
      if (!adoConnected) throw new Error("ADO not connected");
      return { getRepos: vi.fn().mockResolvedValue([]) };
    }),
    getSonarQubeClient: vi.fn().mockReturnValue(
      sonarConnected ? {} : null,
    ),
  };
}

const MINIMAL_LLM_CONFIG = {
  url: "https://llm.example/v1",
  token: "sk-test",
  model: "claude-sonnet-5",
  protocol: "openai" as const,
};

const MINIMAL_ADO_CONFIG = {
  organization: "myorg",
  project: "myproj",
  token: "pat-placeholder",
};

function createRootConfig(
  overrides: Partial<RootAgentConfig> = {},
): RootAgentConfig {
  return {
    openCodeReview: {
      rulesPath: ".ratan/opencodereview/rule.json",
      llm: MINIMAL_LLM_CONFIG,
    },
    ado: MINIMAL_ADO_CONFIG,
    ...overrides,
  } as RootAgentConfig;
}

// ─── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Point OCR_BINARY_PATH at a fake binary so resolveOcrBinary returns it
  // immediately without falling through to the real platform-module
  // resolution (which would resolve the installed OCR package).
  process.env.OCR_BINARY_PATH = "/fake/ocr/binary";
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.OCR_BINARY_PATH;
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("checkReadiness", () => {
  // ── Git ──────────────────────────────────────────────────────────────────

  it("reports git as ok when git --version succeeds", async () => {
    mockExecFile.mockImplementation((file: string, args: string[], _opts: unknown, cb: Function) => {
      if (file === "git") {
        cb(null, { stdout: "git version 2.43.0\n", stderr: "" });
      } else {
        cb(null, { stdout: "✓ Connection test successful\n", stderr: "" });
      }
    });

    const provider = createMockProvider();
    const config = createRootConfig();

    const report = await checkReadiness(provider, config);

    const gitResult = report.results.find((r) => r.name === "Git");
    expect(gitResult).toBeDefined();
    expect(gitResult?.status).toBe("ok");
  });

  // ── ADO ──────────────────────────────────────────────────────────────────

  it("reports ado as ok when connected and listing repos", async () => {
    mockExecFile.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, { stdout: "✓ Connection test successful\n", stderr: "" });
    });

    const provider = createMockProvider({ adoConnected: true });
    const config = createRootConfig();

    const report = await checkReadiness(provider, config);

    const adoResult = report.results.find((r) => r.name === "ADO");
    expect(adoResult?.status).toBe("ok");
    expect(adoResult?.critical).toBe(true);
  });

  it("reports ado as fail when config is incomplete", async () => {
    mockExecFile.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, { stdout: "✓ Connection test successful\n", stderr: "" });
    });

    const provider = createMockProvider({ adoConnected: false });
    const config = createRootConfig({ ado: undefined });

    const report = await checkReadiness(provider, config);

    const adoResult = report.results.find((r) => r.name === "ADO");
    expect(adoResult?.status).toBe("fail");
    expect(adoResult?.critical).toBe(true);
  });

  it("reports ado as fail when getRepos throws", async () => {
    mockExecFile.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, { stdout: "✓ Connection test successful\n", stderr: "" });
    });

    const provider = {
      id: "test",
      connect: vi.fn(),
      getRootConfig: vi.fn(),
      resolveConfigPath: vi.fn(),
      getAdoClient: vi.fn().mockReturnValue({
        getRepos: vi.fn().mockRejectedValue(new Error("Unauthorized")),
      }),
      getSonarQubeClient: vi.fn().mockReturnValue(null),
    };
    const config = createRootConfig();

    const report = await checkReadiness(provider, config);

    const adoResult = report.results.find((r) => r.name === "ADO");
    expect(adoResult?.status).toBe("fail");
    expect(adoResult?.critical).toBe(true);
  });

  // ── LLM ──────────────────────────────────────────────────────────────────

  it("reports llm as ok when OCR llm test succeeds", async () => {
    mockExecFile.mockImplementation((file: string, args: string[], _opts: unknown, cb: Function) => {
      if (file === "git") {
        cb(null, { stdout: "git version 2.43.0\n", stderr: "" });
      } else if (args?.[0] === "llm" && args?.[1] === "test") {
        cb(null, { stdout: "✓ Connection test successful\n", stderr: "" });
      } else {
        cb(null, { stdout: "", stderr: "" });
      }
    });

    const provider = createMockProvider();
    const config = createRootConfig();

    const report = await checkReadiness(provider, config);

    const llmResult = report.results.find((r) => r.name === "LLM");
    expect(llmResult?.status).toBe("ok");
    expect(llmResult?.message).toContain("Connected via OCR test");
  });

  it("reports llm as fail when OCR llm test returns error", async () => {
    mockExecFile.mockImplementation((file: string, args: string[], _opts: unknown, cb: Function) => {
      if (file === "git") {
        cb(null, { stdout: "git version 2.43.0\n", stderr: "" });
      } else if (args?.[0] === "llm" && args?.[1] === "test") {
        cb(new Error("llm request failed: connection refused"), null);
      } else {
        cb(null, { stdout: "", stderr: "" });
      }
    });

    const provider = createMockProvider();
    const config = createRootConfig();

    const report = await checkReadiness(provider, config);

    const llmResult = report.results.find((r) => r.name === "LLM");
    expect(llmResult?.status).toBe("fail");
    expect(llmResult?.message).toContain("OCR LLM test failed");
  });

  it("reports llm as fail when LLM config is incomplete", async () => {
    mockExecFile.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, { stdout: "✓ Connection test successful\n", stderr: "" });
    });

    const provider = createMockProvider();
    const config = createRootConfig({
      openCodeReview: { rulesPath: ".ratan/rules.json", llm: { url: "", token: "", model: "" } } as never,
    });

    const report = await checkReadiness(provider, config);

    const llmResult = report.results.find((r) => r.name === "LLM");
    expect(llmResult?.status).toBe("fail");
    expect(llmResult?.message).toContain("Incomplete LLM configuration");
  });

  it("reports llm as fail when OCR binary is not found", async () => {
    // Delete OCR_BINARY_PATH so resolveOcrBinary falls through to the
    // createRequire path.  If the OCR package is installed, it will still
    // resolve a path and the execFile mock runs; in CI without the OCR
    // package, this exercises the binary-not-available early return in
    // runOcrLlmTest.  Either path correctly reports a failure.
    delete process.env.OCR_BINARY_PATH;

    // In either case the test passes — the binary either can't be loaded
    // (no package) or the call to the fake binary fails.
    mockExecFile.mockImplementation((file: string, args: string[], _opts: unknown, cb: Function) => {
      if (file === "git") {
        cb(null, { stdout: "git version 2.43.0\n", stderr: "" });
      } else if (args?.[0] === "llm" && args?.[1] === "test") {
        // The binary path might be real (OCR package installed) or garbage
        // (not installed).  Either way the execFile mock forces a failure.
        cb(new Error("llm test error"), null);
      } else {
        cb(null, { stdout: "", stderr: "" });
      }
    });

    const provider = createMockProvider();
    const config = createRootConfig();

    const report = await checkReadiness(provider, config);

    const llmResult = report.results.find((r) => r.name === "LLM");
    expect(llmResult?.status).toBe("fail");
    expect(llmResult?.message).toContain("OCR LLM test failed");
  });

  // ── SonarQube ────────────────────────────────────────────────────────────

  it("reports sonarqube as skip when not configured", async () => {
    mockExecFile.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, { stdout: "✓ Connection test successful\n", stderr: "" });
    });

    const provider = createMockProvider();
    const config = createRootConfig();

    const report = await checkReadiness(provider, config);

    const sqResult = report.results.find((r) => r.name === "SonarQube");
    expect(sqResult?.status).toBe("skip");
    expect(sqResult?.critical).toBe(false);
  });

  it("reports sonarqube as ok when connected", async () => {
    mockExecFile.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, { stdout: "✓ Connection test successful\n", stderr: "" });
    });

    const provider = createMockProvider({ sonarConnected: true });
    const config = createRootConfig({
      sonarQube: { url: "https://sonar.example.com/api" },
    });

    const report = await checkReadiness(provider, config);

    const sqResult = report.results.find((r) => r.name === "SonarQube");
    expect(sqResult?.status).toBe("ok");
  });

  it("reports sonarqube as fail when configured but not connected", async () => {
    mockExecFile.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, { stdout: "✓ Connection test successful\n", stderr: "" });
    });

    const provider = createMockProvider({ sonarConnected: false });
    const config = createRootConfig({
      sonarQube: { url: "https://sonar.example.com/api" },
    });

    const report = await checkReadiness(provider, config);

    const sqResult = report.results.find((r) => r.name === "SonarQube");
    expect(sqResult?.status).toBe("fail");
  });

  // ── Report ───────────────────────────────────────────────────────────────

  it("returns allOk=true when all critical deps pass", async () => {
    mockExecFile.mockImplementation((file: string, _args: string[], _opts: unknown, cb: Function) => {
      if (file === "git") {
        cb(null, { stdout: "git version 2.43.0\n", stderr: "" });
      } else {
        cb(null, { stdout: "✓ Connection test successful\n", stderr: "" });
      }
    });

    const provider = createMockProvider({ adoConnected: true });
    const config = createRootConfig({ sonarQube: { url: "https://sonar.example.com" } });

    const report = await checkReadiness(provider, config);

    expect(report.allOk).toBe(true);
    expect(report.criticalFailures).toHaveLength(0);
  });

  it("returns allOk=false and lists criticalFailures when critical deps fail", async () => {
    mockExecFile.mockImplementation((file: string, args: string[], _opts: unknown, cb: Function) => {
      if (file === "git") {
        cb(null, { stdout: "git version 2.43.0\n", stderr: "" });
      } else if (args?.[0] === "llm" && args?.[1] === "test") {
        cb(new Error("llm request failed: EOF"), null);
      } else {
        cb(null, { stdout: "", stderr: "" });
      }
    });

    const provider = createMockProvider({ adoConnected: false });
    const config = createRootConfig();

    const report = await checkReadiness(provider, config);

    expect(report.allOk).toBe(false);
    expect(report.criticalFailures.length).toBeGreaterThanOrEqual(1);
  });

  it("runs all checks in parallel without throwing", async () => {
    mockExecFile.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, { stdout: "", stderr: "" });
    });

    const provider = createMockProvider({ adoConnected: false });
    const config = createRootConfig({ ado: undefined, sonarQube: undefined });

    const report = await checkReadiness(provider, config);

    expect(report.results.length).toBe(4);
  });
});
