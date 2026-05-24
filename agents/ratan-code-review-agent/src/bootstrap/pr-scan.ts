import { minimatch } from "minimatch";
import { Observable } from "rxjs";
import z from "zod";
import type { CommonRequestContextSchema } from "../mastra/types";
import { extractAgentConfig } from "./session";

const PendingPRSchema = z.object({
  repoName: z.string().optional().describe("The name of the repository"),
  prId: z.number().describe("The ID of the pull request"),
});

type PendingPR = z.infer<typeof PendingPRSchema>;

export const scanPRs = ({
  requestContext,
}: {
  requestContext: z.infer<typeof CommonRequestContextSchema>;
}) => {
  return new Observable<PendingPR>((subscriber) => {
    (async () => {
      const configSessionId = requestContext.configSessionId;
      if (!configSessionId) {
        console.error(
          "[scanPRs] Config session ID not found in runtime context",
        );
        throw new Error("Config session ID not found in runtime context");
      }
      console.log(`[scanPRs] Using configSessionId: ${configSessionId}`);

      const agentConfig = extractAgentConfig(requestContext);

      const rootConfig = await agentConfig.getRootConfig();
      const repoNamePatterns = rootConfig.scanRepoNames ?? [];
      const prCreatedDaysAgo = rootConfig.scanPRCreatedDaysAgo ?? 7;
      console.log(
        `[scanPRs] repoNamePatterns: ${JSON.stringify(repoNamePatterns)}, prCreatedDaysAgo: ${prCreatedDaysAgo}`,
      );

      const adoClient = agentConfig.getAdoClient();
      const myRepos = await adoClient.getRepos();
      console.log(`[scanPRs] Total repos fetched: ${myRepos.length}`);

      const ratanRepos = repoNamePatterns.length
        ? myRepos.filter(
            (repo) =>
              repo.name &&
              repoNamePatterns.some((pattern) => minimatch(repo.name, pattern)),
          )
        : myRepos;

      console.log(`[scanPRs] Total Ratan Repos: ${ratanRepos.length}`);

      for (const repo of ratanRepos) {
        if (repo.name) {
          console.log(`[scanPRs] Processing repository: ${repo.name}`);
          const prs =
            (await adoClient.getPullRequestListByRepoName(
              repo.name,
              1,
              new Date(
                Date.now() - prCreatedDaysAgo * 24 * 60 * 60 * 1000,
              ).toISOString(),
            )) ?? [];
          console.log(`[scanPRs] PRs found in ${repo.name}: ${prs.length}`);
          for (const pr of prs) {
            if (!pr.pullRequestId) {
              console.log(
                `[scanPRs] Skipping PR with missing pullRequestId in repo ${repo.name}`,
              );
              continue;
            }
            const isValid = adoClient.isValidPullRequest(pr);
            if (!isValid) {
              console.log(
                `[scanPRs] PR #${pr.pullRequestId} in ${repo.name} is not valid, skipping.`,
              );
              continue;
            }
            const prDetails = await adoClient.getPullRequestById(
              pr.pullRequestId,
              false,
              true,
            );
            const isAlreadyCommented = adoClient.hasAlreadyCommented(
              prDetails.commentThreads ?? [],
            );
            if (isAlreadyCommented) {
              console.log(
                `[scanPRs] PR #${pr.pullRequestId} in ${repo.name} already commented, skipping.`,
              );
              continue;
            }

            subscriber.next({
              repoName: pr.repository?.name,
              prId: pr.pullRequestId,
            });

            console.log(
              `[scanPRs] Added PR #${pr.pullRequestId} from ${repo.name} to pending list.`,
            );
          }
        }
      }
      console.log("[scanPRs] Scan complete.");
    })();
  });
};
