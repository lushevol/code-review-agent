import { createStep } from "@mastra/core/workflows";
import z from "zod";
import { extractAgentConfig } from "../../../bootstrap/session";
import { type CommonRequestContext, PullRequestSchema } from "../../types";
import { CODE_REVIEW_AGENT_LATEST_REVIEW_ID } from "../../utils/const";
import { filterReviewableFiles } from "../../utils/file-filter";
import { maskSensitiveData } from "../../utils/sensitive-data-mask";

const LocateChangesInputSchema = z.object({
  prDetails: PullRequestSchema,
  workItemContext: z.string().optional(),
});

const LocateChangesResultSchema = z.object({
  prDetails: PullRequestSchema,
  workItemContext: z.string().optional(),
});

export const locateChanges = createStep({
  id: "locate-pr-changes",
  description: "Locates pull request changes",
  inputSchema: LocateChangesInputSchema,
  outputSchema: LocateChangesResultSchema,
  execute: async ({ inputData, requestContext }) => {
    if (!inputData) {
      throw new Error("Input data not found");
    }

    const agentConfig = extractAgentConfig(
      requestContext as unknown as CommonRequestContext,
    );

    const adoClient = agentConfig.getAdoClient();

    const {
      repoName,
      repoId,
      pullRequestId: prId,
      codeDiffs,
      codeDiffsArray,
    } = inputData.prDetails;
    const { workItemContext } = inputData;

    let codeChangesArray = codeDiffsArray?.map((i) => {
      return {
        ...i,
        changes: maskSensitiveData(i.changes),
        blocks: i.blocks.map((block) => ({
          ...block,
          mLines: block.mLines.map((line) => maskSensitiveData(line)),
          oLines: block.oLines.map((line) => maskSensitiveData(line)),
        })),
      };
    });

    // get latest file changes
    // 1. initial commits, full file changes
    // 2. subsequent commits, only changed files since last review
    const latestIteration = await adoClient.getLatestPullRequestIterations(
      repoId,
      prId,
    );
    const latestIterationId = latestIteration.id;

    const prProperties = await adoClient.getPullRequestProperties(
      repoName,
      prId,
    );
    const latestReviewId =
      prProperties.value[CODE_REVIEW_AGENT_LATEST_REVIEW_ID]?.$value;

    if (
      latestReviewId !== undefined &&
      Number(latestReviewId) !== latestIterationId
    ) {
      // get changed files
      const changedFiles = await adoClient.getPullRequestIterationChangesFiles({
        repoId,
        prId,
        iterationId: latestIterationId,
        compareToIterationId: latestReviewId ? Number(latestReviewId) : 0,
      });
      // locate fileChanges to only include changed files
      codeChangesArray = codeChangesArray.filter((i) =>
        changedFiles.some(
          (f) =>
            f.newFilePath === i.newFilePath && f.oldFilePath === i.oldFilePath,
        ),
      );
    }

    // filter files based on allowlist/blocklist or deleted.
    const { filePathsAllowlist, filePathsBlocklist } =
      await agentConfig.getRootConfig();
    codeChangesArray = filterReviewableFiles(
      codeChangesArray,
      filePathsAllowlist,
      filePathsBlocklist,
    );

    return {
      prDetails: {
        ...inputData.prDetails,
        codeDiffs: maskSensitiveData(codeDiffs),
        codeDiffsArray: codeChangesArray,
      },
      workItemContext,
    };
  },
});
