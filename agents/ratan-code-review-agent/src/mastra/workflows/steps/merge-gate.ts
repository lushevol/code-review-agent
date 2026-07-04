import { createStep } from "@mastra/core/workflows";
import z from "zod";
import { extractAgentConfig } from "../../../bootstrap/session";
import { type CommonRequestContext, PullRequestSchema } from "../../types";
import { type NormalizedFinding, NormalizedFindingSchema } from "../../types/finding";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const MergeGateInputSchema = z.object({
  prDetails: PullRequestSchema,
  findings: z.array(NormalizedFindingSchema),
});

const MergeGateOutputSchema = z.object({
  mergeDecision: z
    .enum(["allowed", "blocked", "pending"])
    .describe("The merge gate decision"),
});

// ─── Constants ────────────────────────────────────────────────────────────────

// Mirror of azure-devops-node-api GitStatusState enum values.
// Imported as literals to avoid a direct dependency on the package.
const GIT_STATUS_STATE = {
  Pending: 1,
  Succeeded: 2,
  Failed: 3,
} as const;

// ─── Step ─────────────────────────────────────────────────────────────────────

export const mergeGate = createStep({
  id: "merge-gate",
  description: "Evaluate merge gate policy against scanner findings",
  inputSchema: MergeGateInputSchema,
  outputSchema: MergeGateOutputSchema,
  execute: async ({ inputData, requestContext }) => {
    if (!inputData) {
      throw new Error("Input data not found");
    }

    const { findings, prDetails } = inputData;

    const agentConfig = extractAgentConfig(
      requestContext as unknown as CommonRequestContext,
    );

    const adoClient = agentConfig.getAdoClient();

    // ── Evaluate findings ───────────────────────────────────────────────
    const blockingOpen = (findings as NormalizedFinding[]).filter(
      (f) => f.blocking === true && f.resolution === "open",
    );

    const mergeDecision: "allowed" | "blocked" | "pending" =
      blockingOpen.length > 0 ? "blocked" : "allowed";

    // ── Set ADO pull request status ─────────────────────────────────────
    const statusDescription =
      mergeDecision === "blocked"
        ? `Merge blocked: ${blockingOpen.length} unresolved finding(s)`
        : mergeDecision === "allowed"
          ? "All checks passed — merge allowed"
          : "Review in progress";

    const iterationSuffix = prDetails.latestIterationId
      ? `/ Iteration ${prDetails.latestIterationId}`
      : "";
    const commitHint = prDetails.latestSourceCommitId
      ? ` (commit: ${prDetails.latestSourceCommitId.slice(0, 8)})`
      : "";

    const state =
      mergeDecision === "blocked"
        ? GIT_STATUS_STATE.Failed
        : mergeDecision === "allowed"
          ? GIT_STATUS_STATE.Succeeded
          : GIT_STATUS_STATE.Pending;

    try {
      const webApi = adoClient.getAdoClient();
      const gitApi = await webApi.getGitApi();
      const projectName = adoClient.getProjectName();

      await gitApi.createPullRequestStatus(
        {
          state,
          description: statusDescription + commitHint,
          context: {
            name: "PR Guardian / Merge Gate" + iterationSuffix,
            genre: "PR Guardian",
          },
        },
        prDetails.repoName,
        prDetails.pullRequestId,
        projectName,
      );
    } catch (err) {
      console.error(
        `[merge-gate] Failed to set PR status: ${(err as Error).message}`,
      );
      // Non-fatal — decision is still returned
    }

    return { mergeDecision };
  },
});
