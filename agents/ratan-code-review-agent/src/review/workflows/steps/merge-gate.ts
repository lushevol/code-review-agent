import { defineStep } from "../../runtime";
import z from "zod";
import { extractAgentConfig } from "../../../bootstrap/session";
import { type CommonRequestContext, PullRequestSchema } from "../../types";
import { type NormalizedFinding, NormalizedFindingSchema } from "../../types/finding";
import type { RootAgentConfig } from "agent-config-manager";

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const BlockerDetailSchema = z.object({
  category: z.string(),
  severity: z.enum(["error", "warning"]),
  message: z.string(),
  passed: z.boolean(),
});

export type BlockerDetail = z.infer<typeof BlockerDetailSchema>;

const MergeGateInputSchema = z.object({
  prDetails: PullRequestSchema,
  findings: z.array(NormalizedFindingSchema),
  workItemContext: z.string().optional(),
  correlationSummary: z.string(),
  changesSinceLastReview: z.string().optional(),
  reviewSummary: z.string(),
  reviewExecutionStatus: z.enum(["complete", "incomplete"]),
  reviewMetadata: z.record(z.string(), z.unknown()),
  measures: z.union([z.any(), z.null()]),
});

const MergeGateOutputSchema = MergeGateInputSchema.extend({
  mergeDecision: z
    .enum(["allowed", "blocked", "pending"])
    .describe("The merge gate decision"),
  blockerDetails: z
    .array(BlockerDetailSchema)
    .optional()
    .describe("Detailed blocker information per quality gate"),
});

// ─── Constants ────────────────────────────────────────────────────────────────

// Mirror of azure-devops-node-api GitStatusState enum values.
const GIT_STATUS_STATE = {
  Pending: 1,
  Succeeded: 2,
  Failed: 3,
} as const;

// ─── Quality Gate Helpers ────────────────────────────────────────────────────

interface QualityGateConfig {
  coverageThreshold: number;
  blockOnCriticalCve: boolean;
  blockOnHighCve: boolean;
  blockOnMediumCve: boolean;
}

function getQualityGateConfig(config: RootAgentConfig): QualityGateConfig {
  const qg = config.mergePolicy?.qualityGates;
  return {
    coverageThreshold: qg?.coverageThreshold ?? 80,
    blockOnCriticalCve: qg?.blockOnCriticalCve ?? true,
    blockOnHighCve: qg?.blockOnHighCve ?? false,
    blockOnMediumCve: qg?.blockOnMediumCve ?? false,
  };
}

function evaluateCoverageGate(
  measures: Record<string, unknown> | null,
  config: QualityGateConfig,
): BlockerDetail | null {
  if (!measures) return null;

  // New structured format: measures.sonarQube.coverage.line.current
  const sonarQube =
    measures.sonarQube && typeof measures.sonarQube === "object"
      ? (measures.sonarQube as Record<string, unknown>)
      : null;
  const coverage =
    sonarQube?.coverage && typeof sonarQube.coverage === "object"
      ? (sonarQube.coverage as Record<string, unknown>)
      : null;
  const lineMetric =
    coverage?.line && typeof coverage.line === "object"
      ? (coverage.line as Record<string, unknown>)
      : null;
  const lineCoverage =
    typeof lineMetric?.current === "number" ? lineMetric.current : null;

  // Legacy flat format: measures.coverage
  const effectiveCoverage =
    lineCoverage ??
    (typeof measures.coverage === "number" ? measures.coverage : null);

  if (effectiveCoverage === null) return null;

  const passed = effectiveCoverage >= config.coverageThreshold;
  return {
    category: "coverage",
    severity: "error",
    message: `Line coverage: ${effectiveCoverage.toFixed(1)}% (threshold: ${config.coverageThreshold}%)`,
    passed,
  };
}

function evaluateCveGates(
  measures: Record<string, unknown> | null,
  config: QualityGateConfig,
): BlockerDetail[] {
  if (!measures) return [];

  const sonatype =
    measures.sonatype && typeof measures.sonatype === "object"
      ? (measures.sonatype as Record<string, unknown>)
      : null;
  if (!sonatype) return [];

  const critical = typeof sonatype.componentCritical === "number" ? sonatype.componentCritical : 0;
  const severe = typeof sonatype.componentSevere === "number" ? sonatype.componentSevere : 0;
  const moderate = typeof sonatype.componentModerate === "number" ? sonatype.componentModerate : 0;
  const results: BlockerDetail[] = [];

  if (config.blockOnCriticalCve) {
    results.push({
      category: "cve-critical",
      severity: critical > 0 ? "error" : "warning",
      message: `Critical CVEs: ${critical}`,
      passed: critical === 0,
    });
  }

  if (config.blockOnHighCve) {
    results.push({
      category: "cve-high",
      severity: severe > 0 ? "error" : "warning",
      message: `High-severity CVEs: ${severe}`,
      passed: severe === 0,
    });
  }

  if (config.blockOnMediumCve) {
    results.push({
      category: "cve-medium",
      severity: moderate > 0 ? "error" : "warning",
      message: `Medium-severity CVEs: ${moderate}`,
      passed: moderate === 0,
    });
  }

  return results;
}

// ─── Step ─────────────────────────────────────────────────────────────────────

export const mergeGate = defineStep({
  id: "merge-gate",
  description: "Evaluate merge gate policy against scanner findings and quality gates",
  inputSchema: MergeGateInputSchema,
  outputSchema: MergeGateOutputSchema,
  execute: async ({ inputData, requestContext }) => {
    if (!inputData) {
      throw new Error("Input data not found");
    }

    const { findings, prDetails } = inputData;

    const agentConfig = extractAgentConfig(
      requestContext as unknown as CommonRequestContext,
    );

    const adoClient = agentConfig.getAdoClient();
    const rootConfig = await agentConfig.getRootConfig();
    const qualityGateConfig = getQualityGateConfig(rootConfig);

    // ── Evaluate blocking findings ─────────────────────────────────────────
    const blockingOpen = (findings as NormalizedFinding[]).filter(
      (f) => f.blocking === true && f.resolution === "open",
    );

    const blockingFindingsGate: BlockerDetail = {
      category: "blocking-findings",
      severity: blockingOpen.length > 0 ? "error" : "warning",
      message:
        blockingOpen.length > 0
          ? `${blockingOpen.length} unresolved blocking finding(s)`
          : "No unresolved blocking findings",
      passed: blockingOpen.length === 0,
    };

    // ── Evaluate quality gates ─────────────────────────────────────────────
    const measuresObj =
      inputData.measures && typeof inputData.measures === "object"
        ? (inputData.measures as Record<string, unknown>)
        : null;

    const coverageGate = evaluateCoverageGate(measuresObj, qualityGateConfig);
    const cveGates = evaluateCveGates(measuresObj, qualityGateConfig);

    // ── Assemble blocker details ───────────────────────────────────────────
    const blockerDetails: BlockerDetail[] = [
      blockingFindingsGate,
      ...(coverageGate ? [coverageGate] : []),
      ...cveGates,
    ];

    // ── Merge decision ─────────────────────────────────────────────────────
    const anyFailedError = blockerDetails.some(
      (b) => !b.passed && b.severity === "error",
    );

    const mergeDecision: "allowed" | "blocked" | "pending" =
      inputData.reviewExecutionStatus === "incomplete"
        ? "pending"
        : anyFailedError
          ? "blocked"
          : "allowed";

    // ── Set ADO pull request status ────────────────────────────────────────
    const failedGates = blockerDetails.filter((b) => !b.passed);
    const statusDescription =
      mergeDecision === "blocked"
        ? `Merge blocked: ${failedGates.length} policy violation(s)`
        : mergeDecision === "allowed"
          ? "All checks passed — merge allowed"
          : "OpenCodeReview incomplete — manual review required";
    const commitHint = prDetails.latestSourceCommitId
      ? ` (commit: ${prDetails.latestSourceCommitId.slice(0, 8)})`
      : "";

    const state =
      mergeDecision === "blocked"
        ? GIT_STATUS_STATE.Failed
        : mergeDecision === "allowed"
          ? GIT_STATUS_STATE.Succeeded
          : GIT_STATUS_STATE.Pending;

    try {
      await adoClient.createPullRequestStatus(
        prDetails.repoName,
        prDetails.pullRequestId,
        {
          state,
          description: statusDescription + commitHint,
          contextName: "PR Guardian / Merge Gate",
          genre: "PR Guardian",
        },
      );
    } catch (err) {
      console.error(
        `[merge-gate] Failed to set PR status: ${(err as Error).message}`,
      );
      // Non-fatal — decision is still returned
    }

    return { ...inputData, mergeDecision, blockerDetails };
  },
});
