import type { AdoPullRequest } from "ratan-ado-api";
import {
  type CodeReviewIssue,
  type CodeReviewIssueClassification,
  type CodeReviewIssueWithCategory,
  type CodeReviewRescore,
} from "../../types";
import {
  type EngineType,
  type FindingCategory,
  type FindingSeverity,
  type NormalizedFinding,
  computeContentHash,
  generateFindingId,
} from "../../types/finding";
import { chunkContent } from "../../utils/chunk-content";
import { MAX_CHARACTER, UNCATEGORIZED } from "../../utils/const";
import { extractFileExtension } from "../../utils/file-utils";
import { sortIssues } from "../../utils/sort-issues";
import type { Scanner, ScanContext } from "./types";

const SEVERITY_MAP: Record<string, FindingSeverity> = {
  Critical: "critical",
  High: "high",
  Medium: "medium",
  Low: "low",
};

const CATEGORY_PATTERNS: Array<{
  patterns: string[];
  category: FindingCategory;
}> = [
  { patterns: ["bug", "error", "defect", "runtime"], category: "bug" },
  { patterns: ["security", "vulnerability", "xss", "injection"], category: "security" },
  { patterns: ["compliance", "regulatory", "audit"], category: "compliance" },
  { patterns: ["cve"], category: "cve" },
  { patterns: ["dependency"], category: "dependency" },
  { patterns: ["quality", "maintainability", "test", "style", "performance"], category: "quality" },
];

function mapSeverity(severity: string): FindingSeverity {
  return SEVERITY_MAP[severity] ?? "medium";
}

function mapCategory(category: string): FindingCategory {
  const cat = category.toLowerCase();
  for (const { patterns, category: mapped } of CATEGORY_PATTERNS) {
    if (patterns.some((p) => cat.includes(p))) {
      return mapped;
    }
  }
  return "quality";
}

export class AIReviewScanner implements Scanner {
  readonly id = "ai-review";
  readonly engine: EngineType = "ai-review";

  async scan(
    prDetails: AdoPullRequest,
    context: ScanContext,
  ): Promise<{
    findings: NormalizedFinding[];
    engine: EngineType;
    durationMs: number;
  }> {
    const startTime = Date.now();
    const { provider, agents, workItemContext } = context;
    const { codeDiffsArray, repoName, pullRequestId } = prDetails;

    // ── Step 1: Code Review ────────────────────────────────────────────
    const issues: CodeReviewIssue[] = [];

    for (const change of codeDiffsArray) {
      if (change.changes.length === 0) {
        continue;
      }

      const chunks: string[] = chunkContent(change.changes, MAX_CHARACTER);

      for (const chunk of chunks) {
        const instructionsPrompt = await provider.buildPrompt("review", {
          pathVars: {
            repo: repoName,
            extension: extractFileExtension(change.newFilePath),
          },
        });

        const codeReviewAgent = agents.getAgent("codeReviewAgent");
        const workItemSection = workItemContext
          ? `\n${workItemContext}\n`
          : "";

        const prompt = `
          ${instructionsPrompt}
          ${workItemSection}
          ## Code Changes

          <CODE_CHANGES>
          ${chunk}
          </CODE_CHANGES>
        `;

        const output = await codeReviewAgent.generate(prompt);
        const reviewIssues = output.object as CodeReviewIssue[];
        reviewIssues.forEach(
          (i) => (i.file = change.newFilePath ?? change.oldFilePath ?? i.file),
        );
        issues.push(...reviewIssues);
      }
    }

    const sortedIssues = sortIssues(issues);

    if (sortedIssues.length === 0) {
      return {
        findings: [],
        engine: "ai-review",
        durationMs: Date.now() - startTime,
      };
    }

    // ── Step 2: Rescore ────────────────────────────────────────────────
    const rescoreInstructions = await provider.buildPrompt("review-rescore");
    const rescorePrompt = `
      ${rescoreInstructions}

      ## Code Review Issues

      <ISSUES>
      ${JSON.stringify(
        sortedIssues.map((i, index) => ({
          index,
          message: i.message,
          suggestion: i.suggestion,
          suggestion_code: i.suggestion_code,
        })),
      )}
      </ISSUES>
    `;

    const codeReviewRescoreAgent = agents.getAgent("codeReviewRescoreAgent");
    const rescoreOutput = await codeReviewRescoreAgent.generate(rescorePrompt);
    const rerankResults = rescoreOutput.object as CodeReviewRescore[];

    const rescoredIssues = sortedIssues.map((e, idx) => {
      const rerankResult = rerankResults.find((r) => r.index === idx);
      return {
        ...e,
        confidence_score:
          rerankResult?.confidence_score ?? e.confidence_score,
      };
    });

    // ── Step 3: Classify ───────────────────────────────────────────────
    const classifyInstructions = await provider.buildPrompt(
      "issue-classification",
    );
    const classifyPrompt = `
      ${classifyInstructions}

      ## Code Review Issues

      <ISSUES>
      ${JSON.stringify(
        rescoredIssues.map((i, index) => ({
          index,
          message: i.message,
          suggestion: i.suggestion,
        })),
      )}
      </ISSUES>
    `;

    const codeReviewIssueClassificationAgent = agents.getAgent(
      "codeReviewIssueClassificationAgent",
    );
    const classifyOutput =
      await codeReviewIssueClassificationAgent.generate(classifyPrompt);
    const classificationResults =
      classifyOutput.object as CodeReviewIssueClassification[];

    const classifiedIssues: CodeReviewIssueWithCategory[] = rescoredIssues.map(
      (e, idx) => {
        const classificationResult = classificationResults.find(
          (r) => r.index === idx,
        );
        return {
          ...e,
          category: classificationResult?.category ?? UNCATEGORIZED,
          sub_category: classificationResult?.sub_category ?? UNCATEGORIZED,
        };
      },
    );

    // ── Step 4: Map to NormalizedFinding ───────────────────────────────
    const findings: NormalizedFinding[] = classifiedIssues.map((issue) =>
      this.toNormalizedFinding(issue, pullRequestId, repoName),
    );

    return {
      findings,
      engine: "ai-review",
      durationMs: Date.now() - startTime,
    };
  }

  private toNormalizedFinding(
    issue: CodeReviewIssueWithCategory,
    prId: number,
    repository: string,
  ): NormalizedFinding {
    const now = new Date().toISOString();

    return {
      id: generateFindingId(),
      prId,
      repository,
      filePath: issue.file,
      lineStart: issue.line,
      lineEnd: issue.line,
      category: mapCategory(issue.category),
      severity: mapSeverity(issue.severity),
      confidence: issue.confidence_score,
      title: `${issue.severity}: ${issue.message}`,
      description: issue.message,
      evidence: `Line ${issue.line} in ${issue.file}${
        issue.sub_category && issue.sub_category !== UNCATEGORIZED
          ? ` (${issue.category}: ${issue.sub_category})`
          : ""
      }`,
      businessImpact: "",
      remediation: issue.suggestion,
      blocking: issue.severity === "Critical",
      linkedTaskId: null,
      resolution: "open",
      sourceEngine: "ai-review",
      sourceVersion: "1.0.0",
      supersedesFindingId: null,
      contentHash: computeContentHash(issue.file, [
        issue.suggestion ?? "",
        issue.message,
      ]),
      createdAt: now,
      resolvedAt: null,
    };
  }
}
