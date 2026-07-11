import { describe, expect, it, vi } from "vitest";
import * as pullRequestModule from "./pull-request";

describe("getPullRequestMetadataById", () => {
  it("returns clone metadata without requesting remote diffs", async () => {
    const getCommitDiffs = vi.fn();
    const gitApi = {
      getPullRequestById: vi.fn().mockResolvedValue({
        pullRequestId: 42,
        repository: {
          id: "target-id",
          name: "target-repo",
          remoteUrl: "https://dev.azure.com/org/project/_git/target-repo",
          webUrl: "https://dev.azure.com/org/project/_git/target-repo",
          project: { id: "project-id", name: "project" },
        },
        forkSource: {
          name: "refs/heads/feature",
          repository: {
            id: "fork-id",
            remoteUrl: "https://dev.azure.com/org/project/_git/fork-repo",
          },
        },
        lastMergeTargetCommit: { commitId: "base-sha" },
        lastMergeSourceCommit: { commitId: "head-sha" },
        sourceRefName: "refs/heads/feature",
        targetRefName: "refs/heads/main",
        title: "Feature",
        description: "Description",
        status: 1,
        isDraft: false,
        createdBy: { displayName: "Developer", uniqueName: "dev@example.com" },
        reviewers: [],
        creationDate: new Date("2026-01-02T03:04:05.000Z"),
      }),
      getCommitDiffs,
    };
    const fn = (
      pullRequestModule as Record<string, unknown>
    ).getPullRequestMetadataById;

    expect(fn).toBeTypeOf("function");
    const result = await (fn as Function).call(
      { adoWebApi: { getGitApi: async () => gitApi } },
      42,
    );

    expect(result).toMatchObject({
      repoId: "target-id",
      repoName: "target-repo",
      cloneUrl: "https://dev.azure.com/org/project/_git/target-repo",
      sourceRepoId: "fork-id",
      sourceCloneUrl: "https://dev.azure.com/org/project/_git/fork-repo",
      latestTargetCommitId: "base-sha",
      latestSourceCommitId: "head-sha",
      sourceRefName: "refs/heads/feature",
      targetRefName: "refs/heads/main",
      isDraft: false,
    });
    expect(getCommitDiffs).not.toHaveBeenCalled();
  });
});
