import { Operation } from "azure-devops-node-api/interfaces/common/VSSInterfaces";
import { WorkItem } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import { html2markdown } from "ratan-markdown-tool";
import type {
  AdoWebApi,
  CommonWorkItemType,
  StoryWorkItemType,
} from "./interfaces";
import { objectWorkItemPayload2JsonPatchDocument } from "./utils";

export async function getWorkitemsByFields(
  workItemIds: number[],
  fields: string[] = ["System.WorkItemType"],
) {
  const webApi = this.adoWebApi as AdoWebApi;
  const workItemApi = await webApi.getWorkItemTrackingApi();

  const workItems = await workItemApi.getWorkItems(workItemIds, fields);

  return workItems ?? [];
}

export async function getCommonWorkItems(
  workItemIds: number[],
  comments = false,
) {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const workItemApi = await webApi.getWorkItemTrackingApi();
  const workItems = await workItemApi.getWorkItems(
    workItemIds,
    [
      "System.WorkItemType",
      "System.State",
      "System.Title",
      "System.Description",
      "Custom.StepstoReproduce",
      "Microsoft.VSTS.TCM.SystemInfo",
      "Microsoft.VSTS.Common.Severity",
      "Microsoft.VSTS.Common.Priority",
      "Microsoft.VSTS.Common.AcceptanceCriteria",
      "System.AssignedTo",
    ],
    undefined,
    // WorkItemExpand.All,
  );

  if (!workItems || workItems.length === 0) {
    console.log("No work items found for the provided IDs.");
    return [];
  }

  const result: StoryWorkItemType[] = [];

  for (const workItem of workItems) {
    let commentTexts: string[] = [];
    if (comments) {
      const commentsResponse = await workItemApi.getComments(
        projectName,
        Number(workItem.id),
      );
      commentTexts =
        commentsResponse.comments?.map(
          (comment) =>
            `${comment.createdBy?.displayName}: ${html2markdown(comment.text ?? "")}`,
        ) ?? [];
    }
    const workItemFields = workItem.fields || {};

    const parsedWI: StoryWorkItemType = {
      id: workItem.id || -1,
      title: workItemFields["System.Title"] || "",
      state: workItemFields["System.State"] || "",
      type: workItemFields["System.WorkItemType"] || "",
      description: html2markdown(workItemFields["System.Description"] || ""),
      rev: workItem.rev || 0,
      assignedTo: workItemFields["System.AssignedTo"] ?? {},
      acceptanceCriteria: html2markdown(
        workItemFields["Microsoft.VSTS.Common.AcceptanceCriteria"] || "",
      ),
      stepsToReproduce: html2markdown(
        workItemFields["Custom.StepstoReproduce"] || "",
      ),
      areaPath: workItemFields["System.AreaPath"] || "",
      iterationPath: workItemFields["System.IterationPath"] || "",
      severity: workItemFields["Microsoft.VSTS.Common.Severity"] || "",
      priority: workItemFields["Microsoft.VSTS.Common.Priority"] || "",
      comments: commentTexts,
    };
    result.push(parsedWI);
  }

  return result;
}

const relationTypeMap = {
  Related: "System.LinkTypes.Related",
  Tests: "Microsoft.VSTS.Common.TestedBy-Reverse",
  "Tested By": "Microsoft.VSTS.Common.TestedBy-Forward",
  Parent: "System.LinkTypes.Hierarchy-Reverse",
  Child: "System.LinkTypes.Hierarchy-Forward",
};

export async function addRelationsToWorkItem(
  workItemId: number,
  items: {
    workitemId: number;
    type: keyof typeof relationTypeMap;
    comment?: string;
  }[],
): Promise<CommonWorkItemType> {
  if (items.length === 0) {
    return Promise.resolve({} as CommonWorkItemType);
  }
  const webApi = this.adoWebApi as AdoWebApi;
  const workItemApi = await webApi.getWorkItemTrackingApi();
  const projectName = this.getProjectName();

  const document = objectWorkItemPayload2JsonPatchDocument(
    "/relations/-",
    items.map((i) => ({
      rel: relationTypeMap[i.type] ?? "",
      url: `https://dev.azure.com/sc-ado/${projectName}/_apis/wit/workItems/${i.workitemId}`,
      attributes: { comment: i.comment, isLocked: false, name: i.type },
    })),
    Operation.Add,
  );

  const workItem = await workItemApi.updateWorkItem(
    null,
    document,
    workItemId,
    projectName,
  );

  const workItemFields = workItem.fields || {};

  return {
    id: workItem.id || -1,
    title: workItemFields["System.Title"] || "",
    state: workItemFields["System.State"] || "",
    type: workItemFields["System.WorkItemType"] || "",
    description: html2markdown(workItemFields["System.Description"] || ""),
    rev: workItem.rev || 0,
    assignedTo: workItemFields["System.AssignedTo"] ?? {},
    areaPath: workItemFields["System.AreaPath"] || "",
    iterationPath: workItemFields["System.IterationPath"] || "",
  } satisfies CommonWorkItemType;
}
