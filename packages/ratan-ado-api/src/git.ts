import {
  type GitCommitDiffs,
  GitVersionType,
} from "azure-devops-node-api/interfaces/GitInterfaces.js";
import type { AdoWebApi } from "./interfaces";
import { getReleasedPipelineRuns } from "./pipeline";

export async function getFileContent(
  repo: string,
  filePath: string,
  branch: string = "main",
) {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const gitApi = await webApi.getGitApi();

  const res = await gitApi.getItemContent(
    repo,
    filePath,
    projectName,
    undefined,
    0,
    true,
    true,
    false,
    { version: branch, versionOptions: 0, versionType: 0 },
    true,
    true,
    true,
  );

  // Read Node.js Readable stream to string
  const chunks: Buffer[] = [];
  for await (const chunk of res) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export async function getBranchLatestCommit(
  repoName: string,
  branchName = "main",
) {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const gitApi = await webApi.getGitApi();
  const branch = await gitApi.getBranch(repoName, branchName, projectName);
  return branch?.commit?.commitId ?? "";
}

export async function commitCompare({
  repoName,
  baseCommit,
  targetCommit,
}: {
  repoName: string;
  baseCommit: string;
  targetCommit: string;
}) {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const gitApi = await webApi.getGitApi();

  if (!baseCommit || !targetCommit) return null;

  const diff = await gitApi.getCommitDiffs(
    repoName,
    projectName,
    true,
    undefined,
    undefined,
    { version: baseCommit, versionType: GitVersionType.Commit },
    { version: targetCommit, versionType: GitVersionType.Commit },
  );
  return diff;
}

export async function compareWithReleasedProd({
  repoName,
  baseCommit,
}: {
  repoName: string;
  baseCommit: string;
}): Promise<{
  diff: GitCommitDiffs;
  prodBranch: string;
  prodCommit: string;
} | null> {
  if (!baseCommit) return null;
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const gitApi = await webApi.getGitApi();

  const runs = await (
    getReleasedPipelineRuns.bind(this) as typeof getReleasedPipelineRuns
  )(repoName);

  const run = runs.at(0);
  if (!run) return null;
  const releaseCommit = run?.run.sourceVersion;
  const prodBranch = run?.run.sourceBranch;
  if (!releaseCommit) return null;
  const diff = await gitApi.getCommitDiffs(
    repoName,
    projectName,
    false,
    undefined,
    undefined,
    { version: releaseCommit, versionType: GitVersionType.Commit },
    { version: baseCommit, versionType: GitVersionType.Commit },
  );

  return {
    diff,
    prodBranch: prodBranch.replace("refs/heads/", ""),
    prodCommit: releaseCommit,
  };
}

export async function getCommitsBatch(
  repoName: string,
  baseCommit: string,
  targetCommit: string,
) {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const gitApi = await webApi.getGitApi();

  const commits = await gitApi.getCommitsBatch(
    {
      itemVersion: { version: baseCommit, versionType: GitVersionType.Commit },
      compareVersion: {
        version: targetCommit,
        versionType: GitVersionType.Commit,
      },
    },
    repoName,
    projectName,
  );

  return commits;
}

export async function getReleaseDiffChecking(
  repoName: string,
  branchName: string,
  commit: string,
): Promise<{
  diffWithLatestCommit: GitCommitDiffs;
  diffWithReleasedProd: GitCommitDiffs;
  diffWithMainBranch: GitCommitDiffs | null;
  mainDiffWithProd: GitCommitDiffs | null;
  behindMainAllMergeCommit: boolean | null;
  behindProdAllMergeCommit: boolean | null;
  mainBehindProdAllMergeCommit: boolean | null;
  latestBranchCommit: string;
  mainBranchCommit: string | null;
  prodCommit: string;
  prodBranch: string;
}> {
  const MERGE = "Merge";
  const isMain = branchName === "main";
  const latestBranchCommit = await (
    getBranchLatestCommit.bind(this) as typeof getBranchLatestCommit
  )(repoName, branchName);

  // Compare with latest commit in the branch
  const diffWithLatestCommit = await (
    commitCompare.bind(this) as typeof commitCompare
  )({
    repoName,
    baseCommit: latestBranchCommit,
    targetCommit: commit,
  });

  // Compare with prod version
  let behindProdAllMergeCommit: boolean | null = null;
  const {
    diff: diffWithReleasedProd,
    prodBranch = "",
    prodCommit = "",
  } = (await (
    compareWithReleasedProd.bind(this) as typeof compareWithReleasedProd
  )({ repoName, baseCommit: commit })) ?? {};
  if (Number(diffWithReleasedProd?.behindCount) > 0) {
    const commits = await (
      getCommitsBatch.bind(this) as typeof getCommitsBatch
    )(repoName, commit, prodCommit);

    behindProdAllMergeCommit = commits.every((c) =>
      c.comment?.startsWith(MERGE),
    );
  }

  let behindMainAllMergeCommit: boolean | null = null;
  let mainBehindProdAllMergeCommit: boolean | null = null;
  if (!isMain) {
    // Compare with main branch
    const mainBranchCommit = await (
      getBranchLatestCommit.bind(this) as typeof getBranchLatestCommit
    )(repoName, "main");

    const diffWithMainBranch = await (
      commitCompare.bind(this) as typeof commitCompare
    )({
      repoName,
      baseCommit: mainBranchCommit,
      targetCommit: commit,
    });
    if (Number(diffWithMainBranch?.behindCount) > 0) {
      const commits = await (
        getCommitsBatch.bind(this) as typeof getCommitsBatch
      )(repoName, commit, mainBranchCommit);

      behindMainAllMergeCommit = commits.every((c) =>
        c.comment?.startsWith(MERGE),
      );
    }

    // Main compare with Prod
    const { diff: mainDiffWithProd } =
      (await (
        compareWithReleasedProd.bind(this) as typeof compareWithReleasedProd
      )({ repoName, baseCommit: mainBranchCommit })) ?? {};
    if (Number(mainDiffWithProd?.aheadCount) > 0) {
      const commits = await (
        getCommitsBatch.bind(this) as typeof getCommitsBatch
      )(repoName, mainBranchCommit, prodCommit);

      mainBehindProdAllMergeCommit = commits.every((c) =>
        c.comment?.startsWith(MERGE),
      );
    }

    return {
      diffWithLatestCommit: {
        ...diffWithLatestCommit,
        changes: [],
      },
      diffWithReleasedProd: {
        ...diffWithReleasedProd,
        changes: [],
      },
      diffWithMainBranch: {
        ...diffWithMainBranch,
        changes: [],
      },
      mainDiffWithProd: {
        ...mainDiffWithProd,
        changes: [],
      },
      behindMainAllMergeCommit,
      behindProdAllMergeCommit,
      mainBehindProdAllMergeCommit,
      prodCommit,
      prodBranch,
      latestBranchCommit,
      mainBranchCommit,
    };
  }

  return {
    diffWithLatestCommit: {
      ...diffWithLatestCommit,
      changes: [],
    },
    diffWithReleasedProd: {
      ...diffWithReleasedProd,
      changes: [],
    },
    diffWithMainBranch: null,
    mainDiffWithProd: null,
    behindMainAllMergeCommit,
    behindProdAllMergeCommit,
    mainBehindProdAllMergeCommit,
    prodBranch,
    prodCommit,
    latestBranchCommit,
    mainBranchCommit: null,
  };
}
