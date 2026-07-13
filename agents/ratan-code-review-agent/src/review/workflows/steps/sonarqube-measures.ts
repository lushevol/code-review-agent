import { defineStep } from "../../runtime";
import { ParsedMeasuresComponentSchema } from "ratan-sonarqube-api";
import z from "zod";
import { extractAgentConfig } from "../../../bootstrap/session";
import { type CommonRequestContext, PullRequestSchema } from "../../types";
import { NormalizedFindingSchema } from "../../types/finding";
import { withRetry } from "../../utils/retry";

const PRDetailsInputSchema = z.object({
  prDetails: PullRequestSchema,
  workItemContext: z.string().optional(),
  findings: z.array(NormalizedFindingSchema),
  correlationSummary: z.string(),
  changesSinceLastReview: z.string().optional(),
});

const PRDetailsResultSchema = z.object({
  measures: z
    .union([ParsedMeasuresComponentSchema, z.null()])
    .describe("The SonarQube measures for the pull request"),
});

export const sonarqubeMeasures = defineStep({
  id: "sonarqube-measures",
  description: "Fetches SonarQube measures for a pull request",
  inputSchema: PRDetailsInputSchema,
  outputSchema: PRDetailsResultSchema,
  execute: async ({ inputData, requestContext }) => {
    if (!inputData) {
      throw new Error("Input data not found");
    }

    const {
      prDetails: { pullRequestId, repoName },
    } = inputData;

    const agentConfig = extractAgentConfig(
      requestContext as unknown as CommonRequestContext,
    );

    const sonarQubeClient = agentConfig.getSonarQubeClient();

    if (!sonarQubeClient) {
      return {
        measures: null,
      };
    }

    try {
      const rootConfig = await agentConfig.getRootConfig();
      const measures = await withRetry(
        () => sonarQubeClient.getMeasures(pullRequestId, repoName),
        rootConfig.retry,
      );
      return {
        measures,
      };
    } catch (error) {
      console.error("Error fetching SonarQube measures:", error);
      return {
        measures: null,
      };
    }
  },
});
