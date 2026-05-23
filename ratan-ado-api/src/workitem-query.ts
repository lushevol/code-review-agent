import type { AdoWebApi } from "./interfaces";

export async function queryWorkitemsByWiql(queryWiql: string) {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();

  const workitemApi = await webApi.getWorkItemTrackingApi();

  const res = await workitemApi.queryByWiql(
    { query: queryWiql },
    { project: projectName },
  );

  return res;
}

export async function queryWorkitemsByQueryId(queryId: string) {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();

  const workitemApi = await webApi.getWorkItemTrackingApi();

  const res = await workitemApi.queryById(queryId, { project: projectName });

  return res;
}
