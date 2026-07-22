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
  it("adds selected review focuses to OCR context and scanner metadata", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-focus-"));
    const ruleFile = path.join(tempDir, "rule.json");
    fs.writeFileSync(ruleFile, JSON.stringify({ rules: [] }));
    let background = "";
    const runner: OcrReviewRunner = {
      review: async (input) => {
        background = input.background;
        return {
          status: "success",
          complete: true,
          durationMs: 12,
          comments: [],
          warnings: [],
          rawOutput: "",
        };
      },
    };
    const scanner = new OpenCodeReviewScanner(runner);

    const result = await scanner.scan(metadata(), {
      workspace: {
        repoPath: tempDir,
        runDirectory: tempDir,
        mergeBaseCommit: "base",
        headCommit: "head",
        changes: [
          {
            path: "src/user.ts",
            status: "modified",
            addedLines: [
              { line: 1, text: "export interface User { id: string }" },
              { line: 2, text: "} catch (error) {" },
              { line: 3, text: "// Explain recovery" },
            ],
          },
        ],
      },
      provider: provider(ruleFile),
    } as never);

    expect(background).toContain("## Review focus");
    expect(background).toContain("tests");
    expect(background).toContain("error-handling");
    expect(background).toContain("type-design");
    expect(background).toContain("comments");
    expect(result.metadata.reviewFocuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ focus: "general" }),
        expect.objectContaining({ focus: "tests" }),
      ]),
    );
  });

  it("preserves OCR classification and does not create a confidence score", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-scanner-"));
    fs.mkdirSync(path.join(tempDir, "src"));
    fs.writeFileSync(path.join(tempDir, "src/file.ts"), "first\nproblem\nlast\n");
    const ruleFile = path.join(tempDir, "rule.json");
    fs.writeFileSync(ruleFile, JSON.stringify({ rules: [] }));
    const workspace: ReviewWorkspace = {
      repoPath: tempDir,
      runDirectory: tempDir,
      mergeBaseCommit: "base",
      headCommit: "head",
      changes: [],
    };
    const runner: OcrReviewRunner = {
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
      provider: provider(ruleFile),
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

  it("preserves an incomplete OCR execution status", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-incomplete-"));
    const ruleFile = path.join(tempDir, "rule.json");
    fs.writeFileSync(ruleFile, JSON.stringify({ rules: [] }));
    const runner: OcrReviewRunner = {
      review: async () => ({
        status: "timeout",
        complete: false,
        durationMs: 12,
        comments: [],
        warnings: [{ type: "timeout", message: "Review timed out" }],
        rawOutput: "",
      }),
    };

    const result = await new OpenCodeReviewScanner(runner).scan(metadata(), {
      workspace: {
        repoPath: tempDir,
        runDirectory: tempDir,
        mergeBaseCommit: "base",
        headCommit: "head",
        changes: [],
      },
      provider: provider(ruleFile),
    } as never);

    expect(result.executionStatus).toBe("incomplete");
    expect(result.metadata).toMatchObject({
      status: "timeout",
      warningTypes: ["timeout"],
    });
  });
});

function provider(ruleFile: string) {
  return {
    getRootConfig: async () => ({
      openCodeReview: {
        rulesPath: path.basename(ruleFile),
        llm: {
          url: "https://llm.example/v1",
          token: "secret",
          model: "model",
        },
      },
    }),
    resolveConfigPath: () => ruleFile,
  };
}

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
