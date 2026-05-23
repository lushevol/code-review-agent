import axios, { type AxiosInstance } from "axios";
import type {
  AddCommentThreadParams,
  AdoPullRequest,
  AzureDevOpsOptions,
  CodeDiff,
  IterationChangeFile,
  PullRequestIteration,
  PullRequestListItem,
  Repository,
} from "./interfaces";

const AGENT_COMMENT_TAG = "CODE_REVIEW_AGENT";

export class AzureDevOps {
  private client!: AxiosInstance;
  private organization: string;
  private project: string;
  private baseUrl: string;
  private apiVersion = "7.1";

  constructor(options: AzureDevOpsOptions) {
    this.organization = options.organization ?? "default";
    this.project = options.project ?? "default";
    this.baseUrl = `https://dev.azure.com/${this.organization}/${this.project}`;
  }

  public async connect(token: string): Promise<void> {
    const auth = Buffer.from(`:${token}`).toString("base64");
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });
  }

  public async getRepos(): Promise<Repository[]> {
    const response = await this.client.get("/_apis/git/repositories", {
      params: { apiVersion: this.apiVersion },
    });
    return response.data.value.map((repo: any) => ({
      id: repo.id,
      name: repo.name,
      url: repo.url,
    }));
  }

  public async getFileContent(
    repoName: string,
    path: string,
    branch: string,
  ): Promise<string> {
    const encodedPath = path.replace(/\\/g, "/");
    const response = await this.client.get(
      `/_apis/git/repositories/${encodeURIComponent(repoName)}/items`,
      {
        params: {
          path: encodedPath,
          versionDescriptor: {
            version: branch,
            versionType: "branch",
          },
          includeContent: true,
          apiVersion: this.apiVersion,
        },
      },
    );
    return response.data.content;
  }

  public async getPullRequestListByRepoName(
    repoName: string,
    top: number = 100,
    createdDate?: string,
  ): Promise<PullRequestListItem[]> {
    const params: Record<string, any> = {
      "searchCriteria.status": "active",
      "$top": top,
      apiVersion: this.apiVersion,
    };
    if (createdDate) {
      params["searchCriteria.min_time"] = createdDate;
    }

    const response = await this.client.get(
      `/_apis/git/repositories/${encodeURIComponent(repoName)}/pullrequests`,
      { params },
    );
    return response.data.value;
  }

  public async getPullRequestById(
    prId: number,
    includeComments: boolean = false,
    includeWorkItemRefs: boolean = false,
    includeDiffs: boolean = false,
  ): Promise<AdoPullRequest> {
    const params: Record<string, any> = {
      apiVersion: this.apiVersion,
    };

    const repo = await this.getRepoByPRId(prId);

    const response = await this.client.get(
      `/_apis/git/repositories/${repo.id}/pullrequests/${prId}`,
      { params },
    );

    const pr = response.data;

    let codeDiffs = "";
    let codeDiffsArray: CodeDiff[] = [];
    let commentThreads: any[] = [];
    let latestIterationId = 1;

    if (includeDiffs) {
      try {
        const iterationsResp = await this.client.get(
          `/_apis/git/repositories/${repo.id}/pullrequests/${prId}/iterations`,
          { params },
        );
        if (iterationsResp.data.value?.length > 0) {
          const iterations = iterationsResp.data.value;
          const latestIteration = iterations[iterations.length - 1];
          latestIterationId = latestIteration.id;

          const diffResp = await this.client.get(
            `/_apis/git/repositories/${repo.id}/pullrequests/${prId}/iterations/${latestIterationId}/changes`,
            { params },
          );

          if (diffResp.data.changeEntries) {
            for (const entry of diffResp.data.changeEntries) {
              const item = entry.item;
              const changeType = entry.changeType || "edit";
              const newFilePath = item?.path || "";
              const oldFilePath =
                entry.sourceServerItem ||
                (changeType === "add" ? "" : newFilePath);

              const fileContentResp = await this.getFileContent(
                repo.name,
                newFilePath,
                pr.sourceRefName?.replace("refs/heads/", "") || "HEAD",
              ).catch(() => "");

              codeDiffsArray.push({
                changes: `diff --git a/${oldFilePath} b/${newFilePath}\n--- a/${oldFilePath}\n+++ b/${newFilePath}\n@@ -1 +1 @@\n${fileContentResp ? `+${fileContentResp}` : ""}`,
                newFilePath,
                oldFilePath,
                changeType,
              });
            }
            codeDiffs = codeDiffsArray.map((c) => c.changes).join("\n");
          }
        }
      } catch {
        // diffs are best-effort
      }
    }

    if (includeComments) {
      try {
        const threadsResp = await this.client.get(
          `/_apis/git/repositories/${repo.id}/pullrequests/${prId}/threads`,
          { params },
        );
        commentThreads = threadsResp.data.value || [];
      } catch {
        // comments are best-effort
      }
    }

    return {
      pullRequestId: pr.pullRequestId,
      repoName: repo.name,
      repoId: repo.id,
      codeDiffs,
      codeDiffsArray,
      commentThreads,
      latestIterationId,
      title: pr.title,
      description: pr.description,
      createdBy: pr.createdBy?.displayName,
      status: pr.status,
    };
  }

  public isValidPullRequest(pr: PullRequestListItem): boolean {
    return (
      pr.pullRequestId != null &&
      pr.status === "active" &&
      pr.sourceRefName != null &&
      pr.targetRefName != null
    );
  }

  public hasAlreadyCommented(threads: any[]): boolean {
    return threads.some((thread) => {
      if (!thread.comments) return false;
      return thread.comments.some(
        (comment: any) =>
          comment.content?.includes(AGENT_COMMENT_TAG) ||
          comment.content?.includes("CODE_REVIEW_AGENT"),
      );
    });
  }

  public async addCommentThreadForPRCode(
    params: AddCommentThreadParams,
  ): Promise<{ id: number }> {
    const body: Record<string, any> = {
      comments: [{ content: params.comment, commentType: 1 }],
      status: 1, // active
    };

    if (params.filePath) {
      body.threadContext = {
        filePath: params.filePath,
        rightFileStart: {
          line: params.fileStartLine ?? 1,
          offset: params.fileStartOffset ?? 1,
        },
        rightFileEnd: {
          line: params.fileEndLine ?? 1,
          offset: params.fileEndOffset ?? 1,
        },
      };
    }

    const response = await this.client.post(
      `/_apis/git/repositories/${params.repoId}/pullrequests/${params.pullRequestId}/threads`,
      body,
      { params: { apiVersion: this.apiVersion } },
    );

    return { id: response.data.id };
  }

  public async addCommentForPR(
    repoName: string,
    prId: number,
    options: {
      approve: boolean;
      errors: any[];
    },
    summary: string,
    _tags: string[],
    _measures: any,
  ): Promise<{ id: number }> {
    const content = [
      `## Code Review${options.approve ? " ✅" : " ❌"}`,
      "",
      `${AGENT_COMMENT_TAG}`,
      "",
      "### Summary",
      "",
      summary,
      "",
      options.errors.length > 0
        ? `### Issues Found: ${options.errors.length}`
        : "No issues found.",
    ]
      .filter(Boolean)
      .join("\n");

    const response = await this.client.post(
      `/_apis/git/repositories/${encodeURIComponent(repoName)}/pullrequests/${prId}/threads`,
      {
        comments: [{ content, commentType: 1 }],
        status: 4, // closed
      },
      { params: { apiVersion: this.apiVersion } },
    );

    return { id: response.data.id };
  }

  public async setPullRequestProperties(
    repoName: string,
    prId: number,
    properties: Record<string, string>,
  ): Promise<void> {
    const patches = Object.entries(properties).map(([key, value]) => ({
      op: "add",
      path: key,
      value,
    }));

    await this.client.patch(
      `/_apis/git/repositories/${encodeURIComponent(repoName)}/pullrequests/${prId}/properties`,
      patches,
      {
        headers: { "Content-Type": "application/json-patch+json" },
        params: { apiVersion: this.apiVersion },
      },
    );
  }

  public async getLatestPullRequestIterations(
    repoId: string,
    prId: number,
  ): Promise<PullRequestIteration> {
    const response = await this.client.get(
      `/_apis/git/repositories/${repoId}/pullrequests/${prId}/iterations`,
      { params: { apiVersion: this.apiVersion } },
    );
    const iterations = response.data.value;
    if (!iterations?.length) {
      return { id: 1 };
    }
    return iterations[iterations.length - 1];
  }

  public async getPullRequestProperties(
    repoName: string,
    prId: number,
  ): Promise<{ value: Record<string, any> }> {
    const response = await this.client.get(
      `/_apis/git/repositories/${encodeURIComponent(repoName)}/pullrequests/${prId}/properties`,
      { params: { apiVersion: this.apiVersion } },
    );
    return { value: response.data.value || {} };
  }

  public async getPullRequestIterationChangesFiles(params: {
    repoId: string;
    prId: number;
    iterationId: number;
    compareToIterationId?: number;
  }): Promise<IterationChangeFile[]> {
    const response = await this.client.get(
      `/_apis/git/repositories/${params.repoId}/pullrequests/${params.prId}/iterations/${params.iterationId}/changes`,
      {
        params: {
          ...(params.compareToIterationId
            ? { compareTo: params.compareToIterationId }
            : {}),
          apiVersion: this.apiVersion,
        },
      },
    );

    return (response.data.changeEntries || []).map((entry: any) => ({
      newFilePath: entry.item?.path || "",
      oldFilePath: entry.sourceServerItem || entry.item?.path || "",
      changeType: entry.changeType,
    }));
  }

  private async getRepoByPRId(prId: number): Promise<{ id: string; name: string }> {
    const repos = await this.getRepos();
    // try to find the repo that has this PR
    for (const repo of repos) {
      try {
        const prs = await this.getPullRequestListByRepoName(repo.name!, 1);
        if (prs.some((pr) => pr.pullRequestId === prId)) {
          return { id: repo.id!, name: repo.name! };
        }
      } catch {
        continue;
      }
    }
    throw new Error(`Pull request ${prId} not found in any repository`);
  }
}
