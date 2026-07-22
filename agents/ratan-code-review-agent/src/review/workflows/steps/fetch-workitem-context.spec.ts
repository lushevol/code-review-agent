import { afterEach, describe, expect, it, vi } from "vitest";
import { getAgentConfigSessions } from "../../../bootstrap/session";
import { RequestContext } from "../../runtime";
import { fetchWorkItemContext } from "./fetch-workitem-context";

afterEach(() => getAgentConfigSessions().clearSessions());

describe("fetchWorkItemContext", () => {
  it("deduplicates linked and commit-referenced IDs and formats work-item fields", async () => {
    const getCommitsBatch = vi.fn().mockResolvedValue([
      { comment: "Fixes AB#20 and AB#30" },
      { comment: "Duplicate AB#10" },
    ]);
    const getCommonWorkItems = vi.fn().mockResolvedValue([
      {
        id: 10,
        title: "Validate input",
        description: "Reject malformed input",
        acceptanceCriteria: "Returns 400",
        comments: ["Security reviewed", ""],
      },
      { id: 20, title: "Second item" },
    ]);

    const result = await executeFetchWorkItemContext({ getCommitsBatch, getCommonWorkItems });

    expect(getCommonWorkItems).toHaveBeenCalledWith([10, 20, 30], true);
    expect(result.workItemContext).toContain("### #10 - Validate input");
    expect(result.workItemContext).toContain("**Acceptance Criteria:**\nReturns 400");
    expect(result.workItemContext).toContain("- Security reviewed");
    expect(result.workItemContext).toContain("### #20 - Second item");
  });

  it("continues with linked IDs when commit lookup fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const getCommonWorkItems = vi.fn().mockResolvedValue([{ id: 10, title: "Linked" }]);
    const result = await executeFetchWorkItemContext({
      getCommitsBatch: vi.fn().mockRejectedValue(new Error("commit failure")),
      getCommonWorkItems,
    });
    expect(getCommonWorkItems).toHaveBeenCalledWith([10], true);
    expect(result.workItemContext).toContain("Linked");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("returns empty context without fetching details when no IDs exist", async () => {
    const getCommonWorkItems = vi.fn();
    const result = await executeFetchWorkItemContext(
      { getCommitsBatch: vi.fn().mockResolvedValue([]), getCommonWorkItems },
      { workItemIds: [] },
    );
    expect(result.workItemContext).toBe("");
    expect(getCommonWorkItems).not.toHaveBeenCalled();
  });

  it("returns empty context when work-item lookup fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await executeFetchWorkItemContext({
      getCommitsBatch: vi.fn().mockResolvedValue([]),
      getCommonWorkItems: vi.fn().mockRejectedValue(new Error("work items offline")),
    });
    expect(result.workItemContext).toBe("");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

async function executeFetchWorkItemContext(
  adoClient: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  const provider = { id: `work-items-${crypto.randomUUID()}`, getAdoClient: () => adoClient };
  getAgentConfigSessions().registerProvider(provider as never);
  const requestContext = new RequestContext<{ configSessionId: string }>();
  requestContext.set("configSessionId", provider.id);
  return fetchWorkItemContext.execute({
    inputData: {
      prDetails: {
        repoName: "repo",
        repoId: "repo-id",
        pullRequestId: 7,
        latestTargetCommitId: "base",
        latestSourceCommitId: "head",
        workItemIds: [10],
        ...overrides,
      },
    } as never,
    requestContext,
  });
}
