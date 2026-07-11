import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AdoPullRequestMetadata } from "ratan-ado-api";
import { LocalReviewWorkspaceProvider } from "./local-review-workspace";

const tempDirs: string[] = [];

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function createRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "review-workspace-"));
  tempDirs.push(root);
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test");
  fs.writeFileSync(path.join(repo, "hello.txt"), "base\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "base");
  const base = git(repo, "rev-parse", "HEAD");
  git(repo, "checkout", "-b", "feature");
  fs.writeFileSync(path.join(repo, "hello.txt"), "base\nadded\n");
  fs.writeFileSync(path.join(repo, "space name.txt"), "new\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "feature");
  const head = git(repo, "rev-parse", "HEAD");
  return { root, repo, base, head };
}

function metadata(repo: string, base: string, head: string): AdoPullRequestMetadata {
  return {
    repoId: "repo-id",
    repoName: "repo",
    cloneUrl: repo,
    sourceRepoId: "repo-id",
    sourceRepoName: "repo",
    sourceCloneUrl: repo,
    projectName: "project",
    pullRequestId: 7,
    latestTargetCommitId: base,
    latestSourceCommitId: head,
    title: "Feature",
    description: "Description",
    status: 1,
    isDraft: false,
    authorName: "Test",
    authorId: "test@example.com",
    creationDate: "2026-01-01",
    sourceRefName: "refs/heads/feature",
    targetRefName: "refs/heads/main",
    sourceBranch: "feature",
    targetBranch: "main",
    reviewers: [],
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("LocalReviewWorkspaceProvider", () => {
  it("creates a detached worktree and derives added lines from the local range", async () => {
    const fixture = createRepository();
    const workspaceRoot = path.join(fixture.root, "workspaces");
    const provider = new LocalReviewWorkspaceProvider({ workspaceRoot });

    await provider.withWorkspace(
      metadata(fixture.repo, fixture.base, fixture.head),
      async (workspace) => {
        expect(git(workspace.repoPath, "rev-parse", "HEAD")).toBe(fixture.head);
        expect(workspace.mergeBaseCommit).toBe(fixture.base);
        expect(workspace.headCommit).toBe(fixture.head);
        expect(workspace.changes).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: "hello.txt",
              status: "modified",
              addedLines: [{ line: 2, text: "added" }],
            }),
            expect.objectContaining({ path: "space name.txt", status: "added" }),
          ]),
        );
      },
    );

    expect(fs.readdirSync(path.join(workspaceRoot, "runs"))).toHaveLength(0);
    expect(fs.existsSync(path.join(workspaceRoot, "repos", "repo-id.git"))).toBe(true);
  });

  it("removes the worktree when the callback fails", async () => {
    const fixture = createRepository();
    const workspaceRoot = path.join(fixture.root, "workspaces");
    const provider = new LocalReviewWorkspaceProvider({ workspaceRoot });

    await expect(
      provider.withWorkspace(
        metadata(fixture.repo, fixture.base, fixture.head),
        async () => {
          throw new Error("review failed");
        },
      ),
    ).rejects.toThrow("review failed");

    expect(fs.readdirSync(path.join(workspaceRoot, "runs"))).toHaveLength(0);
  });
});
