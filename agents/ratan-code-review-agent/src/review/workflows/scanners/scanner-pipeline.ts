import type { FindingStore } from "finding-store";
import z from "zod";
import { extractAgentConfig } from "../../../bootstrap/session";
import { OpenCodeReviewRunner } from "../../open-code-review/runner";
import type { ReviewFocusSelection } from "../../open-code-review/review-focus-router";
import { defineStep } from "../../runtime";
import { type CommonRequestContext, PullRequestSchema } from "../../types";
import {
  type NormalizedFinding,
  NormalizedFindingSchema,
} from "../../types/finding";
import type { ReviewWorkspace } from "../../workspace/types";
import { reconcileFindings } from "../utils/finding-reconciler";
import { CveScanner } from "./cve-scanner";
import { complianceEngine } from "./compliance-engine";
import { FINDING_SEVERITY_RANK } from "./finding-priority";
import { OpenCodeReviewScanner } from "./open-code-review-scanner";
import type { Scanner, ScannerResult } from "./types";

const ScannerPipelineInputSchema = z.object({
  prDetails: PullRequestSchema,
  workItemContext: z.string().optional(),
  workspace: z.custom<ReviewWorkspace>(),
});

const ReviewExecutionStatusSchema = z.enum(["complete", "incomplete"]);

const ScannerPipelineOutputSchema = z.object({
  prDetails: PullRequestSchema,
  workItemContext: z.string().optional(),
  findings: z.array(NormalizedFindingSchema),
  correlationSummary: z.string(),
  reviewSummary: z.string(),
  reviewExecutionStatus: ReviewExecutionStatusSchema,
  reviewMetadata: z.record(z.string(), z.unknown()),
  changesSinceLastReview: z.string().optional(),
});

export function correlateFindings(findings: NormalizedFinding[]): NormalizedFinding[] {
  const map = new Map<string, NormalizedFinding>();
  for (const finding of findings) {
    const existing = map.get(finding.contentHash);
    if (!existing) {
      map.set(finding.contentHash, finding);
      continue;
    }
    const existingRank = FINDING_SEVERITY_RANK[existing.severity];
    const currentRank = FINDING_SEVERITY_RANK[finding.severity];
    if (currentRank < existingRank) {
      finding.evidence = [existing.evidence, finding.evidence]
        .filter(Boolean)
        .join("\n---\n");
      map.set(finding.contentHash, finding);
    } else {
      existing.evidence = [existing.evidence, finding.evidence]
        .filter(Boolean)
        .join("\n---\n");
    }
  }
  return Array.from(map.values());
}

export function prioritizeFindings(findings: NormalizedFinding[]): NormalizedFinding[] {
  return findings
    .sort(
      (a, b) =>
        FINDING_SEVERITY_RANK[a.severity] -
        FINDING_SEVERITY_RANK[b.severity],
    )
    .slice(0, 100);
}

export function severityCounts(findings: NormalizedFinding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const finding of findings) {
    counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
  }
  return counts;
}

export function aggregateScannerResults(
  scanners: Pick<Scanner, "id" | "engine">[],
  settled: PromiseSettledResult<ScannerResult>[],
): {
  findings: NormalizedFinding[];
  reviewExecutionStatus: "complete" | "incomplete";
  reviewMetadata: Record<string, unknown>;
} {
  const findings: NormalizedFinding[] = [];
  let reviewExecutionStatus: "complete" | "incomplete" = "complete";
  let reviewMetadata: Record<string, unknown> = {
    status: "failed",
    durationMs: 0,
  };

  settled.forEach((result, index) => {
    const scanner = scanners[index];
    if (result.status === "rejected") {
      console.warn(`[scanner-pipeline] ${scanner.id} failed`);
      if (scanner.engine === "open-code-review") {
        reviewExecutionStatus = "incomplete";
      }
      return;
    }
    const value = result.value;
    findings.push(...value.findings);
    if (scanner.engine === "open-code-review") {
      reviewExecutionStatus = value.executionStatus ?? "complete";
      reviewMetadata = {
        ...(value.metadata ?? {}),
        durationMs: value.durationMs,
      };
    }
  });

  return { findings, reviewExecutionStatus, reviewMetadata };
}

export function buildCorrelationSummary(
  findings: NormalizedFinding[],
  reviewFocuses: ReviewFocusSelection[] = [],
): string {
  const buckets = [
    {
      label: "Blocking",
      findings: findings.filter((finding) => finding.blocking),
    },
    {
      label: "Important",
      findings: findings.filter(
        (finding) =>
          !finding.blocking &&
          ["critical", "high", "medium"].includes(finding.severity),
      ),
    },
    {
      label: "Advisory",
      findings: findings.filter(
        (finding) =>
          !finding.blocking &&
          ["low", "informational"].includes(finding.severity),
      ),
    },
  ];
  const lines = ["### Consolidated findings"];

  for (const bucket of buckets) {
    lines.push(`#### ${bucket.label} (${bucket.findings.length})`);
    const categories = new Map<string, NormalizedFinding[]>();
    for (const finding of bucket.findings) {
      const grouped = categories.get(finding.category) ?? [];
      grouped.push(finding);
      categories.set(finding.category, grouped);
    }
    if (categories.size === 0) {
      lines.push("- None");
      continue;
    }
    for (const [category, grouped] of [...categories].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      lines.push(`- **${category}**`);
      for (const finding of [...grouped].sort(
        (a, b) =>
          FINDING_SEVERITY_RANK[a.severity] -
          FINDING_SEVERITY_RANK[b.severity],
      )) {
        const location = finding.filePath
          ? `${finding.filePath}${finding.lineStart === null ? "" : `:${finding.lineStart}`}`
          : "PR-level";
        const description = finding.description.replace(/\s+/g, " ").trim();
        const remediation = finding.remediation.replace(/\s+/g, " ").trim();
        lines.push(
          `  - ${finding.severity.toUpperCase()} — ${finding.title} (` +
            `\`${location}\`)` +
            (description ? `: ${description}` : "") +
            (remediation ? ` Suggestion: ${remediation}` : ""),
        );
      }
    }
  }

  lines.push("#### Review focuses");
  if (reviewFocuses.length === 0) {
    lines.push("- Not recorded");
  } else {
    for (const selection of reviewFocuses) {
      lines.push(`- ${selection.focus}: ${selection.reasons.join(" ")}`);
    }
  }
  return lines.join("\n");
}

export const scannerPipeline = defineStep({
  id: "scanner-pipeline",
  description: "Run OpenCodeReview and optional local-range scanners",
  inputSchema: ScannerPipelineInputSchema,
  outputSchema: ScannerPipelineOutputSchema,
  execute: async ({ inputData, agents, requestContext }) => {
    if (!inputData) throw new Error("Input data not found");

    const { prDetails, workItemContext, workspace } = inputData;
    const agentConfig = extractAgentConfig(
      requestContext as unknown as CommonRequestContext,
    );
    const adoClient = agentConfig.getAdoClient();
    const rootConfig = await agentConfig.getRootConfig();
    const findingStore: FindingStore = new (await import("finding-store")).FindingStore();
    findingStore.init(rootConfig.findingStorePath ?? ".ratan/data/findings.db");

    const ocrRunner = new OpenCodeReviewRunner();
    const scanners: Scanner[] = [new OpenCodeReviewScanner(ocrRunner)];
    const scannerSettings = rootConfig.scannerSettings ?? {};
    if (scannerSettings.cve?.enabled !== false) scanners.push(new CveScanner());
    if (scannerSettings.compliance?.enabled === true) scanners.push(complianceEngine);

    const scanContext = {
      provider: agentConfig,
      adoClient,
      sonarClient: agentConfig.getSonarQubeClient(),
      findingStore,
      agents,
      workItemContext,
      workspace,
      ocrRunner,
    };
    const settled = await Promise.allSettled(
      scanners.map((scanner) => scanner.scan(prDetails, scanContext)),
    );

    const {
      findings: allFindings,
      reviewExecutionStatus,
      reviewMetadata,
    } = aggregateScannerResults(scanners, settled);

    let prioritized = prioritizeFindings(correlateFindings(allFindings));
    let changesSinceLastReview = "";
    try {
      const previous = findingStore.getFindingsByPr(
        prDetails.pullRequestId,
        prDetails.repoName,
      ) as unknown as NormalizedFinding[];
      if (previous.length > 0) {
        const reconciled = reconcileFindings(previous, prioritized);
        const lines = ["#### Changes since last review"];
        if (reconciled.findingsToResolve.length)
          lines.push(`- **${reconciled.findingsToResolve.length}** findings resolved`);
        if (reconciled.findingsToSupersede.length)
          lines.push(`- **${reconciled.findingsToSupersede.length}** findings updated`);
        if (reconciled.findingsToCreate.length)
          lines.push(`- **${reconciled.findingsToCreate.length}** new findings`);
        if (lines.length > 1) changesSinceLastReview = `${lines.join("\n")}\n\n`;
      }
    } catch {
      changesSinceLastReview = "";
    }

    try {
      prioritized = findingStore.batchUpsert(
        prioritized as Parameters<typeof findingStore.batchUpsert>[0],
      ) as NormalizedFinding[];
    } catch {
      console.error("[scanner-pipeline] Failed to persist findings");
    }

    const counts = severityCounts(prioritized);
    const severitySummary = ["critical", "high", "medium", "low", "informational"]
      .map((severity) => `${severity}: ${counts[severity] ?? 0}`)
      .join(", ");
    const reviewedFiles = Number(reviewMetadata.filesReviewed ?? 0);
    const ocrStatus = String(reviewMetadata.status ?? "failed");
    const reviewSummary = [
      `Base: ${workspace.mergeBaseCommit}`,
      `Head: ${workspace.headCommit}`,
      `Changed files: ${workspace.changes.length}`,
      `OCR reviewed files: ${reviewedFiles}`,
      `OCR status: ${ocrStatus}`,
      `Findings: ${severitySummary}`,
    ].join("\n");

    return {
      prDetails,
      workItemContext,
      findings: prioritized,
      correlationSummary: buildCorrelationSummary(
        prioritized,
        Array.isArray(reviewMetadata.reviewFocuses)
          ? (reviewMetadata.reviewFocuses as ReviewFocusSelection[])
          : [],
      ),
      reviewSummary,
      reviewExecutionStatus,
      reviewMetadata,
      changesSinceLastReview,
    };
  },
});
