import { GitStatusState } from "azure-devops-node-api/interfaces/GitInterfaces.js";
import type { AdoWebApi } from "./interfaces";

export async function createPullRequestStatus(
  repoName: string,
  prId: number,
  status: {
    state: GitStatusState;
    description: string;
    contextName: string;
    targetUrl?: string;
    genre?: string;
  },
): Promise<void> {
  const webApi = this.adoWebApi as AdoWebApi;
  const gitApi = await webApi.getGitApi();
  const projectName = this.getProjectName();
  await gitApi.createPullRequestStatus(
    {
      state: status.state,
      description: status.description,
      context: {
        name: status.contextName,
        genre: status.genre ?? "PR Guardian",
      },
      targetUrl: status.targetUrl,
    },
    repoName,
    prId,
    projectName,
  );
}
