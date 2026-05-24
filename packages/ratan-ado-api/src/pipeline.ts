import {
  type Run,
  RunResult,
  RunState,
} from "azure-devops-node-api/interfaces/PipelinesInterfaces.js";
import type { HierarchyRun } from "./extension/HierarchyRun.types";
import { getHierarchyQueryPipelineRuns } from "./extension/PipelineRuns";
import type { AdoWebApi } from "./interfaces";

export async function getPipelineByRepoName(repoName: string) {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const pipelineApi = await webApi.getPipelinesApi();

  const pipelines = await pipelineApi.listPipelines(projectName);
  const pipeline = pipelines.find((p) => {
    const [repoNameOfPipeline] = p.name?.split("_") ?? [];
    return repoNameOfPipeline === repoName;
  });

  return pipeline;
}

export async function getPipelineRuns(
  repoName: string,
  targetBranchName?: string,
  sourceBranchName?: string,
  releaseId?: number,
) {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const pipelineApi = await webApi.getPipelinesApi();

  const pipeline = await (getPipelineByRepoName.call(
    this,
    repoName,
  ) as ReturnType<typeof getPipelineByRepoName>);

  if (pipeline?.id) {
    const pipelineRuns =
      (await pipelineApi.listRuns(projectName, pipeline.id)) ?? [];

    if (pipelineRuns.length > 0) {
      const filteredRuns = pipelineRuns.filter((run) => {
        const matchTargetBranch = targetBranchName
          ? run.variables?.["system.pullRequest.targetBranchName"]?.value ===
            targetBranchName
          : true;
        const matchSourceBranch = sourceBranchName
          ? run.variables?.[
              "system.pullRequest.sourceBranchName"
            ]?.value?.endsWith(sourceBranchName)
          : true;
        const matchReleaseId = releaseId
          ? run.templateParameters?.releaseId === String(releaseId)
          : true;
        return matchTargetBranch && matchSourceBranch && matchReleaseId;
      });

      return filteredRuns;
    } else {
      console.log(
        `No runs found for project: ${projectName}, pipeline: ${pipeline.name}`,
      );
    }
  } else {
    console.log(`No pipeline found for project: ${projectName}`);
  }

  return [];
}

export const filterInprocessingRuns = (runs: Run[]) => {
  return runs.filter(
    (run) =>
      run.state === RunState.InProgress && run.result === RunResult.Succeeded,
  );
};

const filterProdPipelines = (runs: HierarchyRun[]) => {
  return runs.filter((run) => {
    const prodCompleted = run.stages?.some(
      (stage) => stage.refName === "prod" && stage.result === 0,
    );
    const containsRollback = run.stages?.find(
      (stage) => stage.refName === "rollback_prod",
    );
    const rollbackSkipped = containsRollback?.result === 4;

    const result = prodCompleted && (!containsRollback || rollbackSkipped);

    return result;
  });
};

export async function getReleasedPipelineRuns(repoName: string) {
  const pipeline = await (getPipelineByRepoName.call(
    this,
    repoName,
  ) as ReturnType<typeof getPipelineByRepoName>);

  if (!pipeline?.id) {
    return [];
  }

  const releaseBranchRuns = await (
    getHierarchyQueryPipelineRuns.bind(
      this,
    ) as typeof getHierarchyQueryPipelineRuns
  )({
    pipelineId: pipeline?.id,
    keywordFilter: "release",
  });

  const releaseBranchRunsOnProd = filterProdPipelines(releaseBranchRuns);

  if (releaseBranchRunsOnProd.length === 0) {
    const releaseBranchRunsNext = await (
      getHierarchyQueryPipelineRuns.bind(
        this,
      ) as typeof getHierarchyQueryPipelineRuns
    )({
      pipelineId: pipeline?.id,
      keywordFilter: "release",
      continuationToken: releaseBranchRuns.at(-1)?.run.finishTime ?? "",
    });

    releaseBranchRuns.push(...releaseBranchRunsNext);
  }

  const mainBranchRuns = await (
    getHierarchyQueryPipelineRuns.bind(
      this,
    ) as typeof getHierarchyQueryPipelineRuns
  )({
    pipelineId: pipeline?.id,
    keywordFilter: "main",
  });

  // filter runs that have prod stage succeeded and rollback stage skipped
  const runsOnProd = filterProdPipelines([
    ...releaseBranchRuns,
    ...mainBranchRuns,
  ]).toSorted((a, b) => {
    const prodStageA = a.stages?.find((stage) => stage.refName === "prod");
    const prodStageB = b.stages?.find((stage) => stage.refName === "prod");

    if (!prodStageA || !prodStageB) return 0;

    const prodStageFinishTimeA = parseDatetimeFromString(
      prodStageA?.finishTime ?? "",
    );
    const prodStageFinishTimeB = parseDatetimeFromString(
      prodStageB?.finishTime ?? "",
    );

    if (prodStageFinishTimeA === null || prodStageFinishTimeB === null)
      return 0;
    return prodStageFinishTimeB - prodStageFinishTimeA;
  });

  return runsOnProd;
}

// /Date(1758692458792)/
const parseDatetimeFromString = (datetime: string) => {
  if (!datetime) return null;
  const match = datetime.match(/\/Date\((\d+)([+-]\d+)?\)\//);
  if (match) {
    const timestamp = parseInt(match[1], 10);
    return timestamp;
  }
  return null;
};
