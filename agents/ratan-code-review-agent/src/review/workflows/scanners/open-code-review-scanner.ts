import fs from "node:fs";
import path from "node:path";
import type { AdoPullRequestMetadata } from "ratan-ado-api";
import type { OcrReviewRunner } from "../../open-code-review/runner";
import type { ReviewWorkspace } from "../../workspace/types";
import {
  computeContentHash,
  generateFindingId,
  type NormalizedFinding,
} from "../../types/finding";
import type { ScanContext, Scanner } from "./types";

const OCR_VERSION = "1.7.7";

export class OpenCodeReviewScanner implements Scanner {
  readonly id = "open-code-review";
  readonly engine = "open-code-review" as const;

  constructor(private readonly runner: OcrReviewRunner) {}

  async scan(
    prDetails: AdoPullRequestMetadata,
    context: ScanContext,
  ) {
    const rootConfig = await context.provider.getRootConfig();
    const openCodeReview = rootConfig.openCodeReview;
    const output = await this.runner.review({
      workspace: context.workspace,
      background: buildBackground(prDetails, context.workItemContext),
      llm: {
        ...openCodeReview.llm,
        useAnthropic: openCodeReview.llm.useAnthropic ?? false,
      },
      ruleFile: context.provider.resolveConfigPath(openCodeReview.rulesPath),
    });
    const findings = output.comments.map((comment) =>
      this.toFinding(prDetails, context.workspace, comment),
    );
    return {
      findings,
      engine: this.engine,
      durationMs: output.durationMs,
      executionStatus: output.complete ? ("complete" as const) : ("incomplete" as const),
      metadata: {
        status: output.status,
        traceId: output.trace_id,
        sessionId: output.session_id,
        filesReviewed: output.summary?.files_reviewed ?? 0,
        totalTokens: output.summary?.total_tokens ?? 0,
        warningTypes: output.warnings.map((warning) => warning.type),
      },
    };
  }

  private toFinding(
    pr: AdoPullRequestMetadata,
    workspace: ReviewWorkspace,
    comment: Awaited<ReturnType<OcrReviewRunner["review"]>>["comments"][number],
  ): NormalizedFinding {
    const relativePath = comment.path.replace(/^\/+/, "");
    const filePath = `/${relativePath}`;
    const lineStart = comment.start_line > 0 ? comment.start_line : null;
    const lineEnd = comment.end_line > 0 ? comment.end_line : lineStart;
    const context = comment.existing_code
      ? comment.existing_code.split("\n")
      : readLocalContext(workspace.repoPath, relativePath, lineStart);
    const firstLine = comment.content.split("\n").find((line) => line.trim()) ?? "OpenCodeReview finding";
    const title = firstLine.replace(/[*_`#]/g, "").trim().slice(0, 160);
    const now = new Date().toISOString();

    return {
      id: generateFindingId(),
      prId: pr.pullRequestId,
      repository: pr.repoName,
      filePath,
      lineStart,
      lineEnd,
      category: comment.category ?? "other",
      severity: comment.severity ?? "low",
      title: title || "OpenCodeReview finding",
      description: comment.content,
      evidence: lineStart === null ? filePath : `${filePath}:${lineStart}`,
      businessImpact: "",
      remediation: comment.suggestion_code ?? "",
      blocking: comment.severity === "critical",
      linkedTaskId: null,
      resolution: "open",
      sourceEngine: "open-code-review",
      sourceVersion: OCR_VERSION,
      supersedesFindingId: null,
      contentHash: computeContentHash(filePath, context),
      createdAt: now,
      resolvedAt: null,
    };
  }
}

function buildBackground(
  pr: AdoPullRequestMetadata,
  workItemContext?: string,
): string {
  return [
    `# Pull Request ${pr.pullRequestId}: ${pr.title}`,
    "",
    pr.description || "No pull request description provided.",
    "",
    "## Work item context",
    workItemContext || "No linked work-item context available.",
  ].join("\n");
}

function readLocalContext(
  repoPath: string,
  relativePath: string,
  line: number | null,
): string[] {
  try {
    const contents = fs.readFileSync(path.join(repoPath, relativePath), "utf8").split("\n");
    if (line === null) return contents.slice(0, 7);
    const start = Math.max(0, line - 4);
    return contents.slice(start, line + 3);
  } catch {
    return [relativePath, String(line ?? 0)];
  }
}
