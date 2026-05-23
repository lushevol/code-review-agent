import { createStep } from "@mastra/core";
import { ParsedMeasuresComponentSchema } from "ratan-sonarqube-api";
import z from "zod";
import { extractAgentConfig } from "../../../bootstrap/session";
import { type CommonRuntimeContext, PullRequestSchema } from "../../types";

const PRDetailsInputSchema = z.object({
  prDetails: PullRequestSchema,
});

const PRDetailsResultSchema = z.object({
  measures: z
    .union([ParsedMeasuresComponentSchema, z.null()])
    .describe("The SonarQube measures for the pull request"),
});

export const sonarqubeMeasures = createStep({
  id: "sonarqube-measures",
  description: "Fetches SonarQube measures for a pull request",
  inputSchema: PRDetailsInputSchema,
  outputSchema: PRDetailsResultSchema,
  execute: async ({ inputData, runtimeContext }) => {
    if (!inputData) {
      throw new Error("Input data not found");
    }

    const {
      prDetails: { pullRequestId, repoName },
    } = inputData;

    const agentConfig = extractAgentConfig(
      runtimeContext as unknown as CommonRuntimeContext,
    );

    const sonarQubeClient = agentConfig.getSonarQubeClient();

    if (!sonarQubeClient) {
      return {
        measures: null,
      };
    }

    try {
      const measures = await sonarQubeClient.getMeasures(
        pullRequestId,
        repoName,
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
