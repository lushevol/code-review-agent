import { defineStep } from "../../runtime";
import z from "zod";
import { PullRequestSchema } from "../../types";
import { NormalizedFindingSchema } from "../../types/finding";
import type { PRDetailsResult } from "./fetch-pr";

const MergeParallelInputSchema = z.object({
  "code-summary": z.object({
    codeChangeSummary: z.string(),
  }),
  "sonarqube-measures": z.object({
    measures: z.union([z.any(), z.null()]),
  }),
});

const ScannerPipelineResultSchema = z.object({
  prDetails: PullRequestSchema,
  workItemContext: z.string().optional(),
  findings: z.array(NormalizedFindingSchema),
  correlationSummary: z.string(),
  changesSinceLastReview: z.string().optional(),
});

const MergeParallelOutputSchema = z.object({
  prDetails: PullRequestSchema,
  workItemContext: z.string().optional(),
  findings: z.array(NormalizedFindingSchema),
  correlationSummary: z.string(),
  changesSinceLastReview: z.string().optional(),
  codeChangeSummary: z.string(),
  measures: z.union([z.any(), z.null()]),
});

export const mergeParallelResults = defineStep({
  id: "merge-parallel-results",
  description: "Combine scanner, summary, and Sonar outputs for downstream governance steps",
  inputSchema: MergeParallelInputSchema,
  outputSchema: MergeParallelOutputSchema,
  execute: async ({ inputData, getStepResult }) => {
    if (!inputData) {
      throw new Error("Input data not found");
    }

    const scannerPipeline = ScannerPipelineResultSchema.parse(
      getStepResult("scanner-pipeline"),
    );
    const { prDetails } = getStepResult("fetch-pr-details") as PRDetailsResult;

    return {
      prDetails: scannerPipeline.prDetails ?? prDetails,
      workItemContext: scannerPipeline.workItemContext,
      findings: scannerPipeline.findings,
      correlationSummary: scannerPipeline.correlationSummary,
      changesSinceLastReview: scannerPipeline.changesSinceLastReview,
      codeChangeSummary: inputData["code-summary"].codeChangeSummary,
      measures: inputData["sonarqube-measures"].measures,
    };
  },
});
