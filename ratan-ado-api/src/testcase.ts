import { Operation } from "azure-devops-node-api/interfaces/common/VSSInterfaces";
import { WorkItemExpand } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import type { AdoWebApi, TestCaseWorkItemType } from "./interfaces";
import { plainWorkItemPayload2JsonPatchDocument } from "./utils";
import { testCaseAdo2Payload, testCasePayload2ADO } from "./wokitem-mapping";

export async function getTestCaseWorkItems(
  workItemIds: number[],
): Promise<TestCaseWorkItemType[]> {
  const webApi = this.adoWebApi as AdoWebApi;
  const workItemApi = await webApi.getWorkItemTrackingApi();
  const workItems = await workItemApi.getWorkItems(
    workItemIds,
    undefined,
    undefined,
    WorkItemExpand.All,
  );

  if (!workItems || workItems.length === 0) {
    console.log("No work items found for the provided IDs.");
    return [];
  }

  const result: TestCaseWorkItemType[] = [];

  for (const testWorkItem of workItems) {
    const parsedWI = testCaseAdo2Payload(testWorkItem) as TestCaseWorkItemType;
    result.push(parsedWI);
  }

  return result;
}

export async function createTestCaseWorkItem(payload: TestCaseWorkItemType) {
  const webApi = this.adoWebApi as AdoWebApi;
  const WorkItemTrackingApi = await webApi.getWorkItemTrackingApi();

  const workItem = await WorkItemTrackingApi.createWorkItem(
    null,
    plainWorkItemPayload2JsonPatchDocument(
      testCasePayload2ADO(payload),
      Operation.Add,
    ),
    this.getProjectName(),
    "Test Case",
  );

  return workItem;
}

export async function updateTestCaseWorkItem(payload: TestCaseWorkItemType) {
  const webApi = this.adoWebApi as AdoWebApi;
  const WorkItemTrackingApi = await webApi.getWorkItemTrackingApi();

  const workItem = await WorkItemTrackingApi.updateWorkItem(
    null,
    plainWorkItemPayload2JsonPatchDocument(
      testCasePayload2ADO(payload),
      Operation.Replace,
    ),
    payload.id,
    this.getProjectName(),
  );

  return workItem;
}
