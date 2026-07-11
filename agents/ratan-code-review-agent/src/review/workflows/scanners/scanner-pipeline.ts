import type { FindingStore } from "finding-store";
import z from "zod";
import { extractAgentConfig } from "../../../bootstrap/session";
import { OpenCodeReviewRunner } from "../../open-code-review/runner";
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

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  informational: 4,
};

function correlateFindings(findings: NormalizedFinding[]): NormalizedFinding[] {
  const map = new Map<string, NormalizedFinding>();
  for (const finding of findings) {
    const existing = map.get(finding.contentHash);
    if (!existing) {
      map.set(finding.contentHash, finding);
      continue;
    }
    const existingRank = SEVERITY_ORDER[existing.severity] ?? 99;
    const currentRank = SEVERITY_ORDER[finding.severity] ?? 99;
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

function prioritizeFindings(findings: NormalizedFinding[]): NormalizedFinding[] {
  return findings
    .sort(
      (a, b) =>
        (SEVERITY_ORDER[a.severity] ?? 99) -
        (SEVERITY_ORDER[b.severity] ?? 99),
    )
    .slice(0, 100);
}

function severityCounts(findings: NormalizedFinding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const finding of findings) {
    counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
  }
  return counts;
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

    const allFindings: NormalizedFinding[] = [];
    let reviewExecutionStatus: "complete" | "incomplete" = "complete";
    let reviewMetadata: Record<string, unknown> = {
      status: "failed",
      durationMs: 0,
    };

    settled.forEach((result, index) => {
      const scanner = scanners[index];
      if (result.status === "rejected") {
        console.warn(`[scanner-pipeline] ${scanner.id} failed`);
        if (scanner.engine === "open-code-review") reviewExecutionStatus = "incomplete";
        return;
      }
      const value = result.value as ScannerResult;
      allFindings.push(...value.findings);
      if (scanner.engine === "open-code-review") {
        reviewExecutionStatus = value.executionStatus ?? "complete";
        reviewMetadata = {
          ...(value.metadata ?? {}),
          durationMs: value.durationMs,
        };
      }
    });

    const prioritized = prioritizeFindings(correlateFindings(allFindings));
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
      findingStore.batchUpsert(
        prioritized as Parameters<typeof findingStore.batchUpsert>[0],
      );
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
      correlationSummary: `Found ${prioritized.length} issues (${severitySummary})`,
      reviewSummary,
      reviewExecutionStatus,
      reviewMetadata,
      changesSinceLastReview,
    };
  },
});
