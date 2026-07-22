import { afterEach, describe, expect, it, vi } from "vitest";
import { getAgentConfigSessions } from "../../../bootstrap/session";
import { RequestContext } from "../../runtime";
import type { NormalizedFinding } from "../../types/finding";
import { mergeGate } from "./merge-gate";

afterEach(() => getAgentConfigSessions().clearSessions());

describe("mergeGate", () => {
  it.each([
    { status: "complete", findings: [], decision: "allowed", state: 2 },
    {
      status: "complete",
      findings: [finding({ blocking: true })],
      decision: "blocked",
      state: 3,
    },
    {
      status: "incomplete",
      findings: [finding({ blocking: true })],
      decision: "pending",
      state: 1,
    },
  ] as const)("returns $decision for a $status review", async ({ status, findings, decision, state }) => {
    const createPullRequestStatus = vi.fn().mockResolvedValue(undefined);
    const result = await executeMergeGate({
      reviewExecutionStatus: status,
      findings: [...findings],
    }, createPullRequestStatus);

    expect(result.mergeDecision).toBe(decision);
    expect(createPullRequestStatus).toHaveBeenCalledWith("repo", 7, {
      state,
      description: expect.stringContaining("commit: 12345678"),
      contextName: "PR Guardian / Merge Gate",
      genre: "PR Guardian",
    });
  });

  it("ignores blocking findings that are no longer open", async () => {
    const result = await executeMergeGate({
      findings: [finding({ blocking: true, resolution: "waived" })],
    });
    expect(result.mergeDecision).toBe("allowed");
  });

  it("keeps the decision when ADO status publication fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await executeMergeGate({}, vi.fn().mockRejectedValue(new Error("offline")));
    expect(result.mergeDecision).toBe("allowed");
    expect(error).toHaveBeenCalledWith(expect.stringContaining("offline"));
    error.mockRestore();
  });

  it("changes the PR status from blocked to allowed after the user fixes the finding", async () => {
    const createPullRequestStatus = vi.fn().mockResolvedValue(undefined);

    const firstReview = await executeMergeGate({
      findings: [finding({ id: "blocking", blocking: true })],
    }, createPullRequestStatus);
    const fixReview = await executeMergeGate({
      findings: [
        finding({
          id: "blocking",
          blocking: true,
          resolution: "resolved",
        }),
      ],
    }, createPullRequestStatus);

    expect([firstReview.mergeDecision, fixReview.mergeDecision]).toEqual([
      "blocked",
      "allowed",
    ]);
    expect(createPullRequestStatus.mock.calls.map(([, , status]) => status.state))
      .toEqual([3, 2]);
  });

  it("changes the PR status from allowed to blocked when a later commit adds a blocker", async () => {
    const createPullRequestStatus = vi.fn().mockResolvedValue(undefined);

    const cleanReview = await executeMergeGate({}, createPullRequestStatus);
    const regressionReview = await executeMergeGate({
      findings: [finding({ blocking: true })],
    }, createPullRequestStatus);

    expect([cleanReview.mergeDecision, regressionReview.mergeDecision]).toEqual([
      "allowed",
      "blocked",
    ]);
    expect(createPullRequestStatus.mock.calls.map(([, , status]) => status.state))
      .toEqual([2, 3]);
  });

  it.each(["waived", "false-positive", "accepted-risk", "superseded", "resolved"] as const)(
    "does not re-block a continued review for a %s finding",
    async (resolution) => {
      const result = await executeMergeGate({
        findings: [finding({ blocking: true, resolution })],
      });

      expect(result.mergeDecision).toBe("allowed");
    },
  );
});

async function executeMergeGate(
  overrides: Record<string, unknown> = {},
  createPullRequestStatus = vi.fn().mockResolvedValue(undefined),
) {
  const provider = {
    id: `merge-gate-${crypto.randomUUID()}`,
    getAdoClient: () => ({ createPullRequestStatus }),
  };
  getAgentConfigSessions().registerProvider(provider as never);
  const requestContext = new RequestContext<{ configSessionId: string }>();
  requestContext.set("configSessionId", provider.id);
  return mergeGate.execute({
    inputData: {
      prDetails: prDetails(),
      findings: [],
      correlationSummary: "summary",
      reviewSummary: "review",
      reviewExecutionStatus: "complete",
      reviewMetadata: {},
      measures: null,
      ...overrides,
    } as never,
    requestContext,
  });
}

function prDetails() {
  return {
    repoId: "repo-id",
    repoName: "repo",
    cloneUrl: "https://example.invalid/repo.git",
    sourceRepoId: "repo-id",
    sourceRepoName: "repo",
    sourceCloneUrl: "https://example.invalid/repo.git",
    projectName: "project",
    pullRequestId: 7,
    latestTargetCommitId: "base",
    latestSourceCommitId: "1234567890abcdef",
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
  };
}

function finding(overrides: Partial<NormalizedFinding> = {}): NormalizedFinding {
  return {
    id: crypto.randomUUID(),
    prId: 7,
    repository: "repo",
    filePath: "/src/file.ts",
    lineStart: 1,
    lineEnd: 1,
    category: "bug",
    severity: "high",
    title: "Finding",
    description: "Description",
    evidence: "Evidence",
    businessImpact: "Impact",
    remediation: "Fix it",
    blocking: false,
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
