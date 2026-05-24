import type { AdoRepository, AdoWebApi } from "./interfaces";
import { dateToDateString } from "./utils";

export async function getRepos() {
  const webApi = this.adoWebApi as AdoWebApi;
  const gitApi = await webApi.getGitApi();
  const repos = await gitApi.getRepositories();

  return (repos ?? []).map((r) => ({
    ...r,
    creationDate: dateToDateString(r.creationDate),
    project: {
      ...r.project,
      lastUpdateTime: dateToDateString(r.project?.lastUpdateTime),
    },
  })) satisfies AdoRepository[];
}
