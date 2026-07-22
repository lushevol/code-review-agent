import { defineStep } from "../../runtime";
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

export const fetchPR = defineStep({
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
    const prDetails = await adoClient.getPullRequestMetadataById(inputData.prId);
    let workItemIds: number[] = [];
    try {
      const linkedDetails = await adoClient.getPullRequestById(
        inputData.prId,
        true,
        false,
        false,
      );
      workItemIds = linkedDetails.workItemIds;
    } catch (error) {
      console.error("[fetch-pr-details] Error fetching linked work items:", error);
    }

    return {
      prDetails: { ...prDetails, workItemIds },
    };
  },
});
