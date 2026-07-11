import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AdoPullRequestMetadata } from "ratan-ado-api";
import type { OcrReviewRunner } from "../../open-code-review/runner";
import type { ReviewWorkspace } from "../../workspace/types";
import { OpenCodeReviewScanner } from "./open-code-review-scanner";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("OpenCodeReviewScanner", () => {
  it("preserves OCR classification and does not create a confidence score", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-scanner-"));
    fs.mkdirSync(path.join(tempDir, "src"));
    fs.writeFileSync(path.join(tempDir, "src/file.ts"), "first\nproblem\nlast\n");
    const workspace: ReviewWorkspace = {
      repoPath: tempDir,
      runDirectory: tempDir,
      mergeBaseCommit: "base",
      headCommit: "head",
      changes: [],
    };
    const runner: OcrReviewRunner = {
      checkHealth: async () => true,
      review: async () => ({
        status: "success",
        complete: true,
        durationMs: 12,
        trace_id: "trace",
        session_id: "session",
        comments: [
          {
            path: "src/file.ts",
            content: "**Unsafe access**\nThis can throw.",
            suggestion_code: "safeAccess()",
            start_line: 2,
            end_line: 2,
            category: "maintainability",
            severity: "critical",
          },
        ],
        warnings: [],
      }),
    };
    const scanner = new OpenCodeReviewScanner(runner);

    const result = await scanner.scan(metadata(), {
      workspace,
      workItemContext: "Context",
      provider: {
        getRootConfig: async () => ({
          agents: {},
          filePathsAllowlist: ["**/*.ts"],
          filePathsBlocklist: [],
        }),
      },
    } as never);

    expect(result.executionStatus).toBe("complete");
    expect(result.findings[0]).toMatchObject({
      filePath: "/src/file.ts",
      lineStart: 2,
      lineEnd: 2,
      category: "maintainability",
      severity: "critical",
      blocking: true,
      sourceEngine: "open-code-review",
      sourceVersion: "1.7.7",
      title: "Unsafe access",
      remediation: "safeAccess()",
    });
    expect(result.findings[0]).not.toHaveProperty("confidence");
  });
});

function metadata(): AdoPullRequestMetadata {
  return {
    repoId: "repo-id",
    repoName: "repo",
    cloneUrl: "https://example/repo",
    sourceRepoId: "repo-id",
    sourceRepoName: "repo",
    sourceCloneUrl: "https://example/repo",
    projectName: "project",
    pullRequestId: 7,
    latestTargetCommitId: "base",
    latestSourceCommitId: "head",
    title: "Feature",
    description: "Description",
    status: 1,
    isDraft: false,
    authorName: "Test",
    authorId: "test",
    creationDate: "2026-01-01",
    sourceRefName: "refs/heads/feature",
    targetRefName: "refs/heads/main",
    sourceBranch: "feature",
    targetBranch: "main",
    reviewers: [],
  };
}
