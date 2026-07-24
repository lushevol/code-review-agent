import { defineStep } from "../../runtime";
import z from "zod";
import {
  FindingStore,
  type NormalizedFinding as StoredFinding,
} from "finding-store";
import { extractAgentConfig } from "../../../bootstrap/session";
import { type CommonRequestContext, PullRequestSchema } from "../../types";
import { NormalizedFindingSchema } from "../../types/finding";
import { MetricsService } from "../services/metrics-service";

const RecordMetricsInputSchema = z.object({
  prDetails: PullRequestSchema,
  workItemContext: z.string().optional(),
  findings: z.array(NormalizedFindingSchema),
  correlationSummary: z.string(),
  changesSinceLastReview: z.string().optional(),
  reviewSummary: z.string(),
  reviewExecutionStatus: z.enum(["complete", "incomplete"]),
  reviewMetadata: z.record(z.string(), z.unknown()),
  measures: z.union([z.any(), z.null()]),
});

const RecordMetricsOutputSchema = RecordMetricsInputSchema.extend({
  metricsRecordId: z.string().uuid(),
});

export const recordMetrics = defineStep({
  id: "record-metrics",
  description: "Compute and persist review performance metrics",
  inputSchema: RecordMetricsInputSchema,
  outputSchema: RecordMetricsOutputSchema,
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

    try {
      const findings = z
        .array(NormalizedFindingSchema)
        .parse(inputData.findings) as unknown as StoredFinding[];
      const metrics = MetricsService.computeMetrics(
        findingStore,
        inputData.prDetails.pullRequestId,
        inputData.prDetails.repoName,
        findings,
        inputData.measures,
      );

      findingStore.saveMetrics(metrics);
      findingStore.saveToDisk();

      return {
        ...inputData,
        metricsRecordId: metrics.id,
      };
    } finally {
      findingStore.close();
    }
  },
});
