import { defineStep } from "../../runtime";
import z from "zod";
import { extractAgentConfig } from "../../../bootstrap/session";
import { type CommonRequestContext, PullRequestSchema } from "../../types";
import { extractAdoWorkItemIds } from "../../utils/commit-parser";
import { getLogger } from "ratan-logger";

const workflowLogger = getLogger("fetch-workitem-context");

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
        repoName,
        latestTargetCommitId,
        latestSourceCommitId,
        workItemIds = [],
      },
    } = inputData;

    const agentConfig = extractAgentConfig(
      requestContext as unknown as CommonRequestContext,
    );
    const rootConfig = await agentConfig.getRootConfig();
    const adoClient = agentConfig.getAdoClient();

    // Check if work-item context fetching is enabled (default: true)
    const wiCtxConfig = rootConfig.workItemContext ?? {};
    const wiCtxEnabled = wiCtxConfig.enabled !== false;
    if (!wiCtxEnabled) {
      workflowLogger.info("Work-item context fetching is disabled by config");
      return { prDetails: inputData.prDetails, workItemContext: "" };
    }

    const maxStories = wiCtxConfig.maxStories ?? 3;

    // 1. Collect work item IDs from multiple sources
    const allWorkItemIds = new Set<number>();

    for (const id of workItemIds) {
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
      workflowLogger.error("Error fetching commits:", error);
      // Non-fatal — continue with linked work items only
    }

    // 2. Fetch work item details (limited to maxStories)
    if (allWorkItemIds.size === 0) {
      return { prDetails: inputData.prDetails, workItemContext: "" };
    }

    const workItemIdsArray = Array.from(allWorkItemIds).slice(0, maxStories);
    if (workItemIdsArray.length < allWorkItemIds.size) {
      workflowLogger.info(
        `Fetching ${workItemIdsArray.length} of ${allWorkItemIds.size} work items (maxStories=${maxStories})`,
      );
    }

    try {
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
      workflowLogger.error("Error fetching work item context:", error);
      return { prDetails: inputData.prDetails, workItemContext: "" };
    }
  },
});
