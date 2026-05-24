import { hierarchyQueryRequest } from "./HierarchyQuery";
import type { HierarchyRun } from "./HierarchyRun.types";

// get 25 pipeline runs for a build definition
export async function getHierarchyQueryPipelineRuns({
  pipelineId,
  continuationToken,
  branchFilter,
  keywordFilter,
  resultFilter,
  statusFilter,
}: {
  pipelineId: number;
  continuationToken?: string;
  branchFilter?: string;
  keywordFilter?: string;
  resultFilter?: string;
  statusFilter?: string;
}) {
  const body = {
    contributionIds: ["ms.vss-build-web.runs-data-provider"],
    dataProviderContext: {
      properties: {
        ...(continuationToken ? { continuationToken } : {}),
        ...(branchFilter ? { branchFilter } : {}),
        ...(keywordFilter ? { keywordFilter } : {}),
        ...(resultFilter ? { resultFilter } : {}),
        ...(statusFilter ? { statusFilter } : {}),
        definitionId: `${pipelineId}`,
        sourcePage: {
          url: "https://dev.azure.com/sc-ado/FMQPR/_build",
          routeId: "ms.vss-build-web.pipeline-details-route",
          routeValues: {
            project: "FMQPR",
            viewname: "details",
            controller: "ContributedPage",
            action: "Execute",
            serviceHost: "69103c4b-01b6-422c-acd9-39f5942b180a (sc-ado)",
          },
        },
      },
    },
  };
  const result = await (hierarchyQueryRequest.call(this, body) as ReturnType<
    typeof hierarchyQueryRequest
  >);

  return (result?.dataProviders?.["ms.vss-build-web.runs-data-provider"]
    ?.runs ?? []) as HierarchyRun[];
}
