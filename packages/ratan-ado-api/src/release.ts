import { WorkItemExpand } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces.js";
import type { AdoWebApi, ReleaseWorkItemType } from "./interfaces";
import {
  extractWorkitemIdFromUrl,
  parseDeploymentComponents,
  parsePipelineRunFromReleaseDoc,
  parseReleaseWorkitemCustomAndSystemFields,
  splitDeploymentComponents,
} from "./utils";

export async function getReleaseWorkItems(workItemIds: number[]) {
  const webApi = this.adoWebApi as AdoWebApi;
  const workItemApi = await webApi.getWorkItemTrackingApi();
  const workItems = await workItemApi.getWorkItems(
    workItemIds,
    null,
    null,
    WorkItemExpand.All,
  );

  if (!workItems || workItems.length === 0) {
    console.log("No work items found for the provided IDs.");
    return [];
  }

  const result: ReleaseWorkItemType[] = [];

  for (const workItem of workItems) {
    const workItemFields = workItem.fields || {};

    const latestPipelineRuns = parseDeploymentComponents(
      workItemFields["Custom.LatestPipelineRuns"] || "",
    );

    const deploymentComponents = parseDeploymentComponents(
      workItemFields["Custom.DeploymentComponents"],
    );

    const parsedRelease =
      parseReleaseWorkitemCustomAndSystemFields(workItemFields);

    const parsedWI = {
      ...parsedRelease,
      type: parsedRelease.workItemType,
      changeId: workItemFields["Custom.CHGID"] ?? "",
      closedDate: workItemFields["Microsoft.VSTS.Common.ClosedDate"] ?? "",
      deploymentComponents,
      deploymentComponentsPretty: deploymentComponents.map((i) => {
        const [repo, ...rest] = splitDeploymentComponents(i);

        return {
          repo,
          command: rest.join("_"),
        };
      }),
      latestPipelineRuns: latestPipelineRuns.map((i) =>
        parsePipelineRunFromReleaseDoc(i, deploymentComponents),
      ),
      relatedWorkitems:
        workItem.relations
          ?.filter((i) => i.rel === "System.LinkTypes.Related")
          .map((i) => extractWorkitemIdFromUrl(i.url))
          .map((i) => Number(i))
          .filter(Boolean) ?? [],
      testedByWorkitems:
        workItem.relations
          ?.filter((i) => i.rel === "Microsoft.VSTS.Common.TestedBy-Forward")
          .map((i) => extractWorkitemIdFromUrl(i.url))
          .map((i) => Number(i))
          .filter(Boolean) ?? [],
      storiesLinked:
        ((workItemFields["Custom.StoriesLinked"] || "") as string)
          .split(",")
          .map((i) => i.trim())
          .map((i) => Number(i))
          .filter(Boolean) ?? [],
    } as ReleaseWorkItemType;
    result.push(parsedWI);
  }

  return result;
}

/**
 * get release list
 * @param {string} from - start date in ISO format
 * @param {string} to - end date in ISO format
 * @returns {Promise<number[]>} the list of release ids
 */
export async function queryRatanReleaseIds(
  from: string,
  to: string,
): Promise<number[]> {
  const webApi = this.adoWebApi as AdoWebApi;
  const workItemApi = await webApi.getWorkItemTrackingApi();

  const startDatetime = from
    ? `AND [Custom.PlannedReleaseDate] >= '${from}'`
    : "";
  const endDatetime = to ? `AND [Custom.PlannedReleaseDate] <= '${to}'` : "";

  const releases = await workItemApi.queryByWiql({
    query: `SELECT [System.Id] FROM WorkItems WHERE [Custom.ApplicationID] = 'RATAN BA-51358' ${startDatetime} ${endDatetime} AND [System.WorkItemType] = 'Release' AND [System.Title] NOT CONTAINS 'RATAN EOD' ORDER BY [System.CreatedDate] DESC`,
  });

  return releases.workItems?.map((i) => i.id) ?? [];
}
