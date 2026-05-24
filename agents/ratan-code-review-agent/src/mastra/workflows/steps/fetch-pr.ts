import { createStep } from "@mastra/core/workflows";
import z from "zod";
import { extractAgentConfig } from "../../../bootstrap/session";
import { type CommonRequestContext, PullRequestSchema } from "../../types";

const PRDetailsInputSchema = z.object({
  prId: z.number().describe("The ID of the pull request"),
});

export const PRDetailsResultSchema = z.object({
  prDetails: PullRequestSchema,
});

export type PRDetailsResult = z.infer<typeof PRDetailsResultSchema>;

export const fetchPR = createStep({
  id: "fetch-pr-details",
  description: "Fetches pull request details",
  inputSchema: PRDetailsInputSchema,
  outputSchema: PRDetailsResultSchema,
  execute: async ({ inputData, requestContext }) => {
    if (!inputData) {
      throw new Error("Input data not found");
    }

    const agentConfig = extractAgentConfig(
      requestContext as unknown as CommonRequestContext,
    );

    const adoClient = agentConfig.getAdoClient();
    const prDetails = await adoClient.getPullRequestById(
      inputData.prId,
      false,
      false,
      true,
    );

    return {
      prDetails,
    };
  },
});
