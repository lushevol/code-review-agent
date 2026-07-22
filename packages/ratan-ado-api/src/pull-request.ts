import {
  Operation,
  type ResourceRef,
} from "azure-devops-node-api/interfaces/common/VSSInterfaces.js";
import {
  type GitPullRequest,
  type GitPullRequestSearchCriteria,
  GitStatusState,
  GitVersionType,
  PullRequestAsyncStatus,
  PullRequestStatus,
  PullRequestTimeRangeType,
} from "azure-devops-node-api/interfaces/GitInterfaces.js";
import {
  filterChanges,
  getCodeDiffFromHierarchyQuery,
} from "./extension/CodeDiff";
import type { ChangeJsonWithDiff } from "./extension/interfaces";
import type {
  AdoPullRequest,
  AdoPullRequestMetadata,
  AdoWebApi,
  CommentThread,
} from "./interfaces";
import {
  dateToDateString,
  plainWorkItemPayload2JsonPatchDocument,
} from "./utils";

export async function getPullRequestMetadataById(
  pullRequestId: number | string,
): Promise<AdoPullRequestMetadata> {
  const webApi = this.adoWebApi as AdoWebApi;
  const gitApi = await webApi.getGitApi();
  const pr = await gitApi.getPullRequestById(Number(pullRequestId));

  const repository = pr.repository;
  const cloneUrl = repository?.remoteUrl ?? "";
  const sshUrl = repository?.sshUrl || "";
  const sourceRepository = pr.forkSource?.repository ?? repository;
  const sourceCloneUrl = sourceRepository?.remoteUrl ?? cloneUrl;
  const sourceSshUrl = sourceRepository?.sshUrl || "";
  if (!repository?.id || !repository.name || !cloneUrl) {
    throw new Error(`Pull request ${pullRequestId} has no cloneable target repository`);
  }
  if (!sourceRepository?.id || !sourceCloneUrl) {
    throw new Error(`Pull request ${pullRequestId} has no cloneable source repository`);
  }

  const sourceRefName = pr.sourceRefName ?? "";
  const targetRefName = pr.targetRefName ?? "";

  return {
    repoId: repository.id,
    repoName: repository.name,
    cloneUrl,
    sshUrl: sshUrl || undefined,
    sourceRepoId: sourceRepository.id,
    sourceRepoName: sourceRepository.name ?? repository.name,
    sourceCloneUrl,
    sourceSshUrl: sourceSshUrl || undefined,
    projectName: repository.project?.name ?? "",
    pullRequestId: Number(pullRequestId),
    latestTargetCommitId: pr.lastMergeTargetCommit?.commitId ?? "",
    latestSourceCommitId: pr.lastMergeSourceCommit?.commitId ?? "",
    title: pr.title ?? "",
    description: pr.description ?? "",
    status: pr.status ?? 0,
    isDraft: pr.isDraft ?? false,
    authorName: pr.createdBy?.displayName ?? "",
    authorId: pr.createdBy?.uniqueName ?? "",
    creationDate: dateToDateString(pr.creationDate),
    sourceRefName,
    targetRefName,
    sourceBranch: sourceRefName.replace("refs/heads/", ""),
    targetBranch: targetRefName.replace("refs/heads/", ""),
    reviewers: pr.reviewers ?? [],
  };
}

export async function getPullRequestById(
  pullRequestId: number | string,
  includeWorkitems = false,
  includeComments = false,
  includeCodeDiffs = false,
): Promise<AdoPullRequest> {
  const webApi = this.adoWebApi as AdoWebApi;
  const gitApi = await webApi.getGitApi();

  pullRequestId = Number(pullRequestId);

  // Get the pull request details
  const pr = await gitApi.getPullRequestById(pullRequestId);

  const {
    repository: {
      id: repoId = "",
      name: repoName,
      webUrl: repoUrl,
      project: { id: projectId, name: projectName },
    } = {},
    lastMergeTargetCommit: { commitId: latestTargetCommitId } = {},
    lastMergeSourceCommit: { commitId: latestSourceCommitId } = {},
    creationDate,
    title = "",
    status = 0,
    description = "",
    sourceRefName,
    targetRefName,
    createdBy: { displayName: authorName, uniqueName: authorId } = {},
    reviewers,
  } = pr;
  const sourceBranch = sourceRefName.replace("refs/heads/", "");
  const targetBranch = targetRefName.replace("refs/heads/", "");

  let relaventWorkitems: ResourceRef[] = [];
  let relaventComments: CommentThread[] = [];
  let codeDiffs: string = "";
  let codeDiffsArray: ChangeJsonWithDiff[] = [];
  let latestIterationId: number | undefined;

  if (includeWorkitems) {
    const prWithWIAndCommits = await gitApi.getPullRequest(
      repoId,
      pullRequestId,
      projectId,
      0,
      0,
      0,
      true,
      true,
    );

    relaventWorkitems = prWithWIAndCommits.workItemRefs ?? [];
  }

  if (includeComments) {
    const commentThreads = await gitApi.getThreads(
      repoId,
      pullRequestId,
      projectId,
    );

    relaventComments = commentThreads
      .map((thread) => ({
        id: thread.id,
        comments: thread.comments.map((comment) => ({
          id: comment.id,
          parentCommentId: comment.parentCommentId,
          content: comment.content,
          author: {
            userId: comment.author?.id,
            id: comment.author?.id,
            url: comment.author?.url,
            imageUrl: comment.author?.imageUrl,
            descriptor: comment.author?.descriptor,
            displayName: comment.author?.displayName,
            uniqueName: comment.author?.uniqueName,
          },
          publishedDate: comment.publishedDate,
          lastUpdatedDate: comment.lastUpdatedDate,
          lastContentUpdatedDate: comment.lastContentUpdatedDate,
          commentType: comment.commentType,
          isDeleted: comment.isDeleted,
        })),
        status: thread.status,
        isDeleted: thread.isDeleted,
      }))
      .toReversed();
  }

  if (includeCodeDiffs) {
    const latestIteration = await (
      getLatestPullRequestIterations.bind(
        this,
      ) as typeof getLatestPullRequestIterations
    )(repoId, pullRequestId);
    latestIterationId = latestIteration.id;
    const commonRefCommitId = latestIteration?.commonRefCommit?.commitId ?? "";
    const commitDiff = await gitApi.getCommitDiffs(
      pr.repository.id,
      projectName,
      false,
      undefined,
      undefined,
      { version: latestSourceCommitId, versionType: GitVersionType.Commit },
      { version: commonRefCommitId, versionType: GitVersionType.Commit },
    );

    const { differenceText, differenceJson } =
      await (getCodeDiffFromHierarchyQuery.call(
        this,
        pr,
        commitDiff,
      ) as ReturnType<typeof getCodeDiffFromHierarchyQuery>);
    codeDiffs = differenceText;
    codeDiffsArray = differenceJson;
  }

  // console.log("======================");
  // console.log(`Repository Name: ${repoName}`);
  // console.log(`Pull Request ID: ${pullRequestId}`);
  // console.log(`Title: ${title}`);
  // console.log(`Description: ${description}`);
  // console.log(`Status: ${PullRequestStatus[status]}`);
  // console.log(`Author: ${authorName} (${authorId})`);
  // console.log(`Create Time: ${creationDate}`);
  // console.log(`Source Branch: ${sourceBranch}`);
  // console.log(`Target Branch: ${targetBranch}`);
  // console.log(`Target Branch: ${targetRefName}`);
  // console.log(
  //   `Work Items: ${relaventWorkitems.map((item) => item.id).join(", ")}`,
  // );
  // console.log(
  //   `Comments: ${relaventComments.length > 0 ? relaventComments.map((comment) => comment.comments.map((c) => c.content).join(", ")).join("; ") : "No comments"}`,
  // );
  // console.log("======================");

  return {
    repoId,
    repoName,
    repoUrl,
    projectName,
    pullRequestId,
    latestTargetCommitId,
    latestSourceCommitId,
    title,
    description,
    status,
    authorName,
    authorId,
    creationDate: dateToDateString(creationDate),
    sourceRefName,
    targetRefName,
    sourceBranch,
    targetBranch,
    reviewers,
    latestIterationId,
    workItemIds: relaventWorkitems.map((item) => Number(item.id)),
    commentThreads: relaventComments,
    codeDiffs,
    codeDiffsArray,
  };
}

const isDateIn2Months = (date: Date | string) => {
  const now = new Date();
  const d = new Date(date);
  const months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  return months <= 2;
};

export const isValidPullRequest = (
  pr: GitPullRequest & { commentThreads?: CommentThread[] },
) => {
  const latestCommitDate =
    pr.commits?.at(0)?.committer?.date ?? pr.creationDate;
  const isRaisedByHuman = /^\d+@/.test(`${pr?.createdBy?.uniqueName}`);
  const isActive = pr.mergeStatus === PullRequestAsyncStatus.Succeeded;
  const isFreshPR = latestCommitDate
    ? isDateIn2Months(latestCommitDate)
    : false;
  return isRaisedByHuman && isActive && isFreshPR;
};

export const hasAlreadyCommented = (comments: CommentThread[]) => {
  for (const comment of comments) {
    const content = comment.comments?.at(0)?.content ?? "";
    if (content.includes("Ratan Code Review Agent")) {
      return true;
    } else if (/^The reference .+ was updated.$/.test(content)) {
      return false;
    }
  }
  return false;
};

export async function getPullRequestListByRepoName(
  repoName: string,
  status: PullRequestStatus = PullRequestStatus.Active,
  createAfter: string = "",
) {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const gitApi = await webApi.getGitApi();
  const searchCriteria: GitPullRequestSearchCriteria = {
    status,
  };
  if (createAfter) {
    searchCriteria.minTime = new Date(createAfter);
    searchCriteria.queryTimeRangeType = PullRequestTimeRangeType.Created;
  }
  const pullRequests = await gitApi.getPullRequests(
    repoName,
    searchCriteria,
    projectName,
  );
  return pullRequests;
}

export async function getPullRequestsByBranchName(
  repo: string,
  sourceBranch: string,
  targetBranch: string = "main",
  status: PullRequestStatus = PullRequestStatus.Active,
) {
  if (!repo || !sourceBranch) {
    console.error("[ado] Repository and source branch are required");
    return [];
  }
  const webApi = this.adoWebApi as AdoWebApi;
  const gitApi = await webApi.getGitApi();
  const projectName = this.getProjectName();
  const pullRequests = await gitApi.getPullRequests(
    repo,
    {
      sourceRefName: `refs/heads/${sourceBranch}`,
      targetRefName: `refs/heads/${targetBranch}`,
      status,
    },
    projectName,
  );
  return pullRequests;
}

export async function getPullRequestChangesFiles(prId: number) {
  const webApi = this.adoWebApi as AdoWebApi;
  const gitApi = await webApi.getGitApi();
  const projectName = this.getProjectName();

  const pr = await (getPullRequestById.bind(this) as typeof getPullRequestById)(
    prId,
  );
  const { repoId, pullRequestId, latestSourceCommitId } = pr;

  const latestIteration = await (
    getLatestPullRequestIterations.bind(
      this,
    ) as typeof getLatestPullRequestIterations
  )(repoId, pullRequestId);
  const commonRefCommitId = latestIteration?.commonRefCommit?.commitId ?? "";
  const commitDiff = await gitApi.getCommitDiffs(
    repoId,
    projectName,
    false,
    undefined,
    undefined,
    { version: latestSourceCommitId, versionType: GitVersionType.Commit },
    { version: commonRefCommitId, versionType: GitVersionType.Commit },
  );

  const changes = filterChanges(commitDiff.changes ?? []);
  return { commitDiff: commitDiff, fileChanges: changes };
}

export async function getPullRequestIterations(
  repoId: string,
  pullRequestId: number,
) {
  const webApi = this.adoWebApi as AdoWebApi;
  const gitApi = await webApi.getGitApi();
  const projectName = this.getProjectName();

  const pullrequestIterations = await gitApi.getPullRequestIterations(
    repoId,
    pullRequestId,
    projectName,
    true,
  );

  return pullrequestIterations;
}

export async function getLatestPullRequestIterations(
  repoId: string,
  pullRequestId: number,
) {
  const pullrequestIterations = await (getPullRequestIterations.call(
    this,
    repoId,
    pullRequestId,
  ) as ReturnType<typeof getPullRequestIterations>);
  // const maxIterationId = Math.max(
  //   ...pullrequestIterations.map((iteration) => iteration.id || 0),
  // );
  // const latestIteration = pullrequestIterations.find(i => i.id === maxIterationId);
  const latestIteration = pullrequestIterations.at(-1);

  return latestIteration;
}

export async function getPullRequestIterationChangesFiles({
  repoId,
  prId,
  iterationId,
  compareToIterationId,
}: {
  repoId: string;
  prId: number;
  iterationId: number;
  compareToIterationId?: number;
}) {
  const webApi = this.adoWebApi as AdoWebApi;
  const gitApi = await webApi.getGitApi();
  const projectName = this.getProjectName();

  const iterationFiles = await gitApi.getPullRequestIterationChanges(
    repoId,
    prId,
    iterationId,
    projectName,
    undefined,
    undefined,
    compareToIterationId,
  );

  const files = filterChanges(iterationFiles.changeEntries);
  return files;
}

export async function getPullRequestProperties(repoName: string, prId: number) {
  const webApi = this.adoWebApi as AdoWebApi;
  const gitApi = await webApi.getGitApi();
  const projectName = this.getProjectName();

  const properties = await gitApi.getPullRequestProperties(
    repoName,
    prId,
    projectName,
  );
  return properties as {
    count: number;
    value: Record<string, { $type: string; $value: string }>;
  };
}

export async function setPullRequestProperties(
  repoName: string,
  prId: number,
  properties: Record<string, string>,
) {
  const webApi = this.adoWebApi as AdoWebApi;
  const gitApi = await webApi.getGitApi();
  const projectName = this.getProjectName();

  const res = await gitApi.updatePullRequestProperties(
    undefined,
    plainWorkItemPayload2JsonPatchDocument(properties, Operation.Replace),
    repoName,
    prId,
    projectName,
  );
  return res;
}

export async function getLatestPullRequestStatus(
  repoName: string,
  prId: number,
) {
  const webApi = this.adoWebApi as AdoWebApi;
  const gitApi = await webApi.getGitApi();
  const projectName = this.getProjectName();

  const pullRequestStatuses = await gitApi.getPullRequestStatuses(
    repoName,
    prId,
    projectName,
  );

  const latestPullRequestStatus = pullRequestStatuses.at(-1);

  return {
    buildSuccessed: [
      GitStatusState.Succeeded,
      GitStatusState.PartiallySucceeded,
      GitStatusState.NotApplicable,
    ].includes(latestPullRequestStatus?.state),
    status: latestPullRequestStatus,
  };
}

export async function getPullRequestStatuses(repoName: string, prId: number) {
  const webApi = this.adoWebApi as AdoWebApi;
  const gitApi = await webApi.getGitApi();
  const projectName = this.getProjectName();

  return gitApi.getPullRequestStatuses(repoName, prId, projectName);
}
