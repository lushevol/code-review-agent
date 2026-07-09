import { defineStep } from "../../runtime";
import z from "zod";
import { extractAgentConfig } from "../../../bootstrap/session";
import { type CommonRequestContext, PullRequestSchema } from "../../types";
import { extractAdoWorkItemIds } from "../../utils/commit-parser";

const FetchWorkItemContextInputSchema = z.object({
  prDetails: PullRequestSchema,
});

const FetchWorkItemContextResultSchema = z.object({
  prDetails: PullRequestSchema,
  workItemContext: z.string(),
});

export const fetchWorkItemContext = defineStep({
  id: "fetch-ado-context",
  description:
    "Fetches ADO work item context from commit messages and linked work items",
  inputSchema: FetchWorkItemContextInputSchema,
  outputSchema: FetchWorkItemContextResultSchema,
  execute: async ({ inputData, requestContext }) => {
    if (!inputData) {
      throw new Error("Input data not found");
    }

    const {
      prDetails: {
        pullRequestId,
        repoName,
        repoId,
        workItemIds,
        latestTargetCommitId,
        latestSourceCommitId,
      },
    } = inputData;

    const agentConfig = extractAgentConfig(
      requestContext as unknown as CommonRequestContext,
    );
    const adoClient = agentConfig.getAdoClient();

    // 1. Collect work item IDs from multiple sources
    const allWorkItemIds = new Set<number>();

    // Already-linked work items from the PR
    for (const id of workItemIds ?? []) {
      allWorkItemIds.add(id);
    }

    // Work items referenced in commit messages
    try {
      const commits = await adoClient.getCommitsBatch(
        repoName,
        latestTargetCommitId,
        latestSourceCommitId,
      );
      const commitMessages: string[] = (commits ?? []).map(
        (c: { comment?: string }) => c.comment ?? "",
      );
      const idsFromCommits = extractAdoWorkItemIds(commitMessages);
      for (const id of idsFromCommits) {
        allWorkItemIds.add(id);
      }
    } catch (error) {
      console.error("Error fetching commits:", error);
      // Non-fatal — continue with linked work items only
    }

    // 2. Fetch work item details
    if (allWorkItemIds.size === 0) {
      return { prDetails: inputData.prDetails, workItemContext: "" };
    }

    try {
      const workItemIdsArray = Array.from(allWorkItemIds);
      const workItems = await adoClient.getCommonWorkItems(
        workItemIdsArray,
        true, // include comments
      );

      // 3. Format as markdown context
      const parts: string[] = [];
      parts.push("## PR Context from Work Items\n");

      for (const wi of workItems ?? []) {
        const id = wi.id;
        const title = wi.title ?? "Untitled";
        const description = wi.description ?? "";
        const acceptanceCriteria = wi.acceptanceCriteria ?? "";
        const comments = wi.comments ?? [];

        parts.push(`### #${id} - ${title}`);

        if (description) {
          parts.push(`**Description:**\n${description}\n`);
        }

        if (acceptanceCriteria) {
          parts.push(`**Acceptance Criteria:**\n${acceptanceCriteria}\n`);
        }

        if (Array.isArray(comments) && comments.length > 0) {
          parts.push("**Comments:**");
          for (const comment of comments) {
            if (comment) {
              parts.push(`- ${comment}`);
            }
          }
        }
      }

      return { prDetails: inputData.prDetails, workItemContext: parts.join("\n") };
    } catch (error) {
      console.error("Error fetching work item context:", error);
      return { prDetails: inputData.prDetails, workItemContext: "" };
    }
  },
});
