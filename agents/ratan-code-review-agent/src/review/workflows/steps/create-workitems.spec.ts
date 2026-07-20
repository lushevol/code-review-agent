import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FindingStore } from "finding-store";
import { getAgentConfigSessions } from "../../../bootstrap/session";
import { RequestContext } from "../../runtime";
import type { NormalizedFinding } from "../../types/finding";
import { createWorkItems } from "./create-workitems";

const tempDirectories: string[] = [];

afterEach(() => {
  getAgentConfigSessions().clearSessions();
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("createWorkItems", () => {
  it("does not call ADO when no open critical or high findings exist", async () => {
    const getWorkItemTrackingApi = vi.fn();
    const result = await executeCreateWorkItems(
      [finding({ severity: "medium" }), finding({ severity: "high", resolution: "resolved" })],
      { getWorkItemTrackingApi },
    );
    expect(result.createdWorkItems).toBe(0);
    expect(getWorkItemTrackingApi).not.toHaveBeenCalled();
  });

  it("creates Bugs for critical findings and Tasks for high findings", async () => {
    const createWorkItem = vi
      .fn()
      .mockResolvedValueOnce({ id: 101 })
      .mockResolvedValueOnce({ id: 102 });
    const updateWorkItem = vi.fn().mockResolvedValue(undefined);
    const critical = finding({ severity: "critical", title: "Critical defect" });
    const high = finding({ severity: "high", title: "High defect" });

    const result = await executeCreateWorkItems([critical, high], {
      getWorkItemTrackingApi: vi.fn().mockResolvedValue({ createWorkItem, updateWorkItem }),
    });

    expect(result.createdWorkItems).toBe(2);
    expect(createWorkItem.mock.calls.map((call) => call[3])).toEqual(["Bug", "Task"]);
    expect(createWorkItem.mock.calls[0][1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "/fields/System.Title", value: expect.stringContaining("Critical defect") }),
      expect.objectContaining({ path: "/fields/System.Description", value: expect.stringContaining("pullrequest/7") }),
    ]));
    expect(updateWorkItem).toHaveBeenCalledTimes(2);
    expect(critical.linkedTaskId).toBe(101);
    expect(high.linkedTaskId).toBe(102);
  });

  it("skips a finding that already has a linked work item", async () => {
    const directory = makeTempDirectory();
    const dbPath = path.join(directory, "findings.db");
    const linked = finding({ linkedTaskId: 55 });
    const store = new FindingStore(dbPath);
    store.init();
    store.upsertFinding(linked);
    store.close();
    const createWorkItem = vi.fn();

    const result = await executeCreateWorkItems(
      [linked],
      { getWorkItemTrackingApi: vi.fn().mockResolvedValue({ createWorkItem }) },
      dbPath,
    );
    expect(result.createdWorkItems).toBe(0);
    expect(createWorkItem).not.toHaveBeenCalled();
  });

  it("continues after individual creation failures and missing IDs", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const createWorkItem = vi
      .fn()
      .mockRejectedValueOnce(new Error("first failed"))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 103 });
    const result = await executeCreateWorkItems(
      [finding(), finding(), finding()],
      {
        getWorkItemTrackingApi: vi.fn().mockResolvedValue({
          createWorkItem,
          updateWorkItem: vi.fn().mockResolvedValue(undefined),
        }),
      },
    );
    expect(result.createdWorkItems).toBe(1);
    expect(createWorkItem).toHaveBeenCalledTimes(3);
    expect(error).toHaveBeenCalled();
    expect(warning).toHaveBeenCalled();
    error.mockRestore();
    warning.mockRestore();
  });

  it("counts a created item even if linking it back to the PR fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await executeCreateWorkItems([finding()], {
      getWorkItemTrackingApi: vi.fn().mockResolvedValue({
        createWorkItem: vi.fn().mockResolvedValue({ id: 104 }),
        updateWorkItem: vi.fn().mockRejectedValue(new Error("link failed")),
      }),
    });
    expect(result.createdWorkItems).toBe(1);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("link failed"));
    warning.mockRestore();
  });
});

async function executeCreateWorkItems(
  findings: NormalizedFinding[],
  webApi: Record<string, unknown>,
  suppliedDbPath?: string,
) {
  const dbPath = suppliedDbPath ?? path.join(makeTempDirectory(), "findings.db");
  const adoClient = {
    getOrganization: () => "organization",
    getProjectName: () => "project",
    getAdoClient: () => webApi,
  };
  const provider = {
    id: `create-work-items-${crypto.randomUUID()}`,
    getAdoClient: () => adoClient,
    getRootConfig: async () => ({ findingStorePath: dbPath }),
  };
  getAgentConfigSessions().registerProvider(provider as never);
  const requestContext = new RequestContext<{ configSessionId: string }>();
  requestContext.set("configSessionId", provider.id);
  return createWorkItems.execute({
    inputData: {
      prDetails: { repoName: "repo name", pullRequestId: 7 },
      findings,
      correlationSummary: "summary",
      reviewSummary: "review",
      reviewExecutionStatus: "complete",
      reviewMetadata: {},
      measures: null,
      mergeDecision: "blocked",
    } as never,
    requestContext,
    agents: { getAgent: vi.fn() },
    getStepResult: vi.fn(),
  });
}

function makeTempDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "create-workitems-"));
  tempDirectories.push(directory);
  return directory;
}

function finding(overrides: Partial<NormalizedFinding> = {}): NormalizedFinding {
  return {
    id: crypto.randomUUID(),
    prId: 7,
    repository: "repo name",
    filePath: "/src/file.ts",
    lineStart: 4,
    lineEnd: 5,
    category: "security",
    severity: "high",
    title: "Unsafe behavior",
    description: "Description",
    evidence: "const unsafe = true",
    businessImpact: "Risk",
    remediation: "Use the safe API",
    blocking: true,
    linkedTaskId: null,
    resolution: "open",
    sourceEngine: "open-code-review",
    sourceVersion: "test",
    supersedesFindingId: null,
    contentHash: crypto.randomUUID(),
    createdAt: "2026-07-15T00:00:00.000Z",
    resolvedAt: null,
    ...overrides,
  };
}
