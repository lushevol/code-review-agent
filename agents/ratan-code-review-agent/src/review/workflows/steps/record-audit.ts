import { defineStep } from "../../runtime";
import z from "zod";
import { randomUUID } from "node:crypto";
import { FindingStore } from "finding-store";
import { extractAgentConfig } from "../../../bootstrap/session";
import { type CommonRequestContext, PullRequestSchema } from "../../types";
import { type EngineType, NormalizedFindingSchema } from "../../types/finding";
import { AuditService } from "../services/audit-service";

const RecordAuditInputSchema = z.object({
  prDetails: PullRequestSchema,
  workItemContext: z.string().optional(),
  findings: z.array(NormalizedFindingSchema),
  correlationSummary: z.string(),
  changesSinceLastReview: z.string().optional(),
  reviewSummary: z.string(),
  reviewExecutionStatus: z.enum(["complete", "incomplete"]),
  reviewMetadata: z.record(z.string(), z.unknown()),
  measures: z.union([z.any(), z.null()]),
  mergeDecision: z.enum(["allowed", "blocked", "pending"]),
});

const RecordAuditOutputSchema = RecordAuditInputSchema.extend({
  auditRecordId: z.string().uuid(),
});

export const recordAudit = defineStep({
  id: "record-audit",
  description: "Persist an audit record for the PR review",
  inputSchema: RecordAuditInputSchema,
  outputSchema: RecordAuditOutputSchema,
  execute: async ({ inputData, requestContext }) => {
    if (!inputData) {
      throw new Error("Input data not found");
    }

    const agentConfig = extractAgentConfig(
      requestContext as unknown as CommonRequestContext,
    );
    const rootConfig = await agentConfig.getRootConfig();
    const findingStore = new FindingStore(
      rootConfig.findingStorePath ?? ".ratan/data/findings.db",
    );
    findingStore.init();

    const auditRecordId = randomUUID();
    const now = new Date().toISOString();
    const engines = Array.from(
      new Set(inputData.findings.map((finding) => finding.sourceEngine)),
    ) as EngineType[];
    const auditService = new AuditService(findingStore);

    try {
      await auditService.recordReview({
        id: auditRecordId,
        prId: inputData.prDetails.pullRequestId,
        repository: inputData.prDetails.repoName,
        commitHash: inputData.prDetails.latestSourceCommitId,
        baseCommitHash: inputData.prDetails.latestTargetCommitId,
        reviewStartTimestamp: now,
        reviewEndTimestamp: now,
        scanners: engines.map((engine) => ({
          engine,
          version:
            inputData.findings.find((finding) => finding.sourceEngine === engine)
              ?.sourceVersion ?? "unknown",
          durationMs:
            engine === "open-code-review"
              ? Number(inputData.reviewMetadata.durationMs ?? 0)
              : 0,
        })),
        modelVersion: process.env.OCR_LLM_MODEL ?? "unknown",
        findingsCount: inputData.findings.length,
        blockingFindingsCount: inputData.findings.filter(
          (finding) => finding.blocking && finding.resolution === "open",
        ).length,
        mergePolicyDecision: inputData.mergeDecision,
        supersedesReviewId: null,
        rawScannerOutputs: {
          reviewExecutionStatus: inputData.reviewExecutionStatus,
          ocr: inputData.reviewMetadata,
          correlationSummary: inputData.correlationSummary,
        },
      });
    } finally {
      findingStore.close();
    }

    return {
      ...inputData,
      auditRecordId,
    };
  },
});
