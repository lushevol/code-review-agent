import { describe, expect, it } from "vitest";
import { recordMetrics } from "./record-metrics";

describe("recordMetrics input", () => {
  it("accepts workflow data before the merge gate has produced a decision", () => {
    const result = recordMetrics.inputSchema?.safeParse({
      prDetails: {
        repoId: "repo-id",
        repoName: "repo",
        cloneUrl: "https://example.invalid/repo.git",
        sourceRepoId: "repo-id",
        sourceRepoName: "repo",
        sourceCloneUrl: "https://example.invalid/repo.git",
        projectName: "project",
        pullRequestId: 7,
        latestTargetCommitId: "base",
        latestSourceCommitId: "head",
        title: "PR",
        description: "description",
        status: 1,
        isDraft: false,
        authorName: "Author",
        authorId: "author-id",
        creationDate: "2026-07-15T00:00:00.000Z",
        sourceRefName: "refs/heads/feature",
        targetRefName: "refs/heads/main",
        sourceBranch: "feature",
        targetBranch: "main",
        reviewers: [],
      },
      findings: [],
      correlationSummary: "No findings",
      reviewSummary: "Review complete",
      reviewExecutionStatus: "complete",
      reviewMetadata: {},
      measures: null,
    });

    expect(result?.success).toBe(true);
  });
});
