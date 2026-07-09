import { RequestContext } from "../../runtime";
import { describe, expect, it, vi } from "vitest";
import { getAgentConfigSessions } from "../../../bootstrap/session";
import { locateChanges } from "./locate-changes";

function createChange(filePath: string, changes: string) {
  return {
    newFilePath: filePath,
    oldFilePath: filePath,
    changeType: "Edit",
    blocks: [
      {
        changeType: 1,
        oLine: 1,
        oLinesCount: 0,
        mLine: 1,
        mLinesCount: 1,
        oLines: [],
        mLines: [changes],
      },
    ],
    changes,
  };
}

function createPrDetails() {
  return {
    repoId: "repo-1",
    repoName: "repo",
    repoUrl: "https://dev.azure.com/org/project/_git/repo",
    projectName: "project",
    pullRequestId: 10,
    latestTargetCommitId: "target",
    latestSourceCommitId: "source",
    title: "PR",
    description: "desc",
    status: 0,
    authorName: "author",
    authorId: "author@example.com",
    creationDate: "2024-01-01T00:00:00.000Z",
    sourceRefName: "refs/heads/feature",
    targetRefName: "refs/heads/main",
    sourceBranch: "feature",
    targetBranch: "main",
    reviewers: [],
    latestIterationId: 2,
    workItemIds: [],
    commentThreads: [],
    codeDiffs: "password = \"super-secret\"",
    codeDiffsArray: [
      createChange("src/keep.ts", "password = \"super-secret\""),
      createChange("src/drop.ts", "const value = 1;"),
    ],
  };
}

describe("locateChanges", () => {
  it("passes through prDetails with masked and filtered codeDiffsArray", async () => {
    const provider = {
      id: "locate-test",
      getAdoClient: () => ({
        getLatestPullRequestIterations: vi.fn().mockResolvedValue({ id: 2 }),
        getPullRequestProperties: vi.fn().mockResolvedValue({
          value: {
            "/code-review-agent/latest-review-id": { $value: "1" },
          },
        }),
        getPullRequestIterationChangesFiles: vi.fn().mockResolvedValue([
          { newFilePath: "src/keep.ts", oldFilePath: "src/keep.ts" },
        ]),
      }),
      getRootConfig: vi.fn().mockResolvedValue({
        filePathsAllowlist: ["src/**/*.ts"],
        filePathsBlocklist: ["src/drop.ts"],
      }),
    };
    getAgentConfigSessions().clearSessions();
    getAgentConfigSessions().registerProvider(provider as any);
    const requestContext = new RequestContext();
    requestContext.set("configSessionId", provider.id);

    const result = await (locateChanges as any).execute({
      inputData: {
        prDetails: createPrDetails(),
        workItemContext: "context",
      },
      requestContext,
    });

    expect(result.workItemContext).toBe("context");
    expect(result.prDetails.codeDiffs).toContain('password="****"');
    expect(result.prDetails.codeDiffsArray).toHaveLength(1);
    expect(result.prDetails.codeDiffsArray[0].newFilePath).toBe("src/keep.ts");
    expect(result.prDetails.codeDiffsArray[0].changes).toContain('password="****"');
  });
});
