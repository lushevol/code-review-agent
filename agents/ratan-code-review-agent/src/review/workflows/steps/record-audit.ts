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
    await findingStore.init();

    const auditRecordId = randomUUID();
    const now = new Date().toISOString();
    const engines = Array.from(
      new Set(inputData.findings.map((finding) => finding.sourceEngine)),
    ) as EngineType[];
    const auditService = new AuditService(findingStore);
    const duplicateSuppressionReasons = asRecord(
      inputData.reviewMetadata.duplicateSuppressionReasons,
    );
    const inlineSuppressionReasons = asRecord(
      inputData.reviewMetadata.inlineSuppressionReasons,
    );

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
          reviewFocuses: sanitizeReviewFocuses(
            inputData.reviewMetadata.reviewFocuses,
          ),
          ocrStatus: String(inputData.reviewMetadata.status ?? "failed"),
          ocrWarningTypes: Array.isArray(
            inputData.reviewMetadata.warningTypes,
          )
            ? inputData.reviewMetadata.warningTypes.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
          ocrWarningMessages: Array.isArray(
            inputData.reviewMetadata.warningMessages,
          )
            ? inputData.reviewMetadata.warningMessages.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
          ocrDurationMs: metricNumber(inputData.reviewMetadata.durationMs),
          reviewedFileCount: metricNumber(
            inputData.reviewMetadata.filesReviewed,
          ),
          postableFindingCount: metricNumber(
            inputData.reviewMetadata.postableFindingCount,
          ),
          rawOcrOutput: String(inputData.reviewMetadata.rawOutput ?? ""),
          rawOutputPath: String(inputData.reviewMetadata.rawOutputPath ?? ""),
          duplicateSuppressionReasons: {
            contentHashCorrelation: metricNumber(
              duplicateSuppressionReasons.contentHashCorrelation,
            ),
            inlineContentHash: metricNumber(
              duplicateSuppressionReasons.inlineContentHash,
            ),
            previouslyLinkedThread: metricNumber(
              duplicateSuppressionReasons.previouslyLinkedThread,
            ),
          },
          inlineSuppressionReasons: {
            invalidCodeLocation: metricNumber(
              inlineSuppressionReasons.invalidCodeLocation,
            ),
            commentLimit: metricNumber(
              inlineSuppressionReasons.commentLimit,
            ),
          },
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

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function metricNumber(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function sanitizeReviewFocuses(
  value: unknown,
): Array<{ focus: string; reasons: string[] }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (typeof record.focus !== "string" || !Array.isArray(record.reasons)) {
      return [];
    }
    return [
      {
        focus: record.focus,
        reasons: record.reasons.filter(
          (reason): reason is string => typeof reason === "string",
        ),
      },
    ];
  });
}
