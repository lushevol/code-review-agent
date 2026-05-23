import type { WorkItem } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import type { TestCaseWorkItemType } from "./interfaces";

export const testCaseWorkItemMapping = {
  id: "/id",
  title: "/fields/System.Title",
  state: "/fields/System.State",
  type: "/fields/System.WorkItemType",
  description: "/fields/System.Description",
  assignedTo: "/fields/System.AssignedTo/displayName",
  areaPath: "/fields/System.AreaPath",
  teamProject: "/fields/System.TeamProject",
  priority: "/fields/Microsoft.VSTS.Common.Priority",
  steps: "/fields/Microsoft.VSTS.TCM.Steps",
  tags: "/fields/System.Tags",
  testType: "/fields/Custom.TestType",
  automationStatus: "/fields/Microsoft.VSTS.TCM.AutomationStatus",
  automatedTestType: "/fields/Microsoft.VSTS.TCM.AutomatedTestType",
  automatedTestId: "/fields/Microsoft.VSTS.TCM.AutomatedTestId",
  automatedTestStorage: "/fields/Microsoft.VSTS.TCM.AutomatedTestStorage",
  automatedTestName: "/fields/Microsoft.VSTS.TCM.AutomatedTestName",
  messageBanner: "/fields/Custom.MessageBanner",
  createdDate: "/fields/System.CreatedDate",
  createdBy: "/fields/System.CreatedBy/displayName",
  relations: "/relations",
};

export const testCasePayload2ADO = (
  payload: TestCaseWorkItemType,
): Record<string, string> => {
  const result: Record<string, string> = {};
  Object.entries(payload)
    .filter(([key]) => {
      return [
        "title",
        "areaPath",
        "description",
        "steps",
        "state",
        "tags",
        "testType",
        "priority",
        "automationStatus",
      ].includes(key);
    })
    .forEach(([key, value]) => {
      const adoKey = testCaseWorkItemMapping[key];
      result[adoKey] = `${value}`;
    });
  return result;
};

const adoWorkItemExtractor = (workItem: WorkItem, path: string) => {
  if (path === "/id") return workItem.id;
  if (path.startsWith("/fields/")) {
    const fieldPath = path.replace("/fields/", "");
    const [fieldPart, subField] = fieldPath.split("/");
    return subField
      ? workItem.fields[fieldPart]?.[subField]
      : workItem.fields[fieldPath];
  }
  if (path === "/relations") {
    return workItem.relations || [];
  }
  return;
};

export const testCaseAdo2Payload = (
  adoWorkItem: WorkItem,
): Record<string, any> => {
  const result: Record<string, string> = {};
  Object.entries(testCaseWorkItemMapping).forEach(([key, adoPath]) => {
    const value = adoWorkItemExtractor(adoWorkItem, adoPath);
    if (value !== undefined) {
      result[key] = value;
    }
  });
  return result;
};
