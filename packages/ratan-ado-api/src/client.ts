import * as vm from "azure-devops-node-api";
import type { IRequestOptions } from "azure-devops-node-api/interfaces/common/VsoBaseInterfaces.js";
import {
  getArtifactsByBuildId,
  getBuildAttachmentContent,
  getBuildAttachments,
  getBuildById,
  getBuildChangesByBuildId,
  getBuildLogsByBuildId,
  getBuildPropertiesByBuildId,
  getBuildReportByBuildId,
} from "./build";
import config from "./config.json" with { type: "json" };
import { getCodeDiffFromHierarchyQuery } from "./extension/CodeDiff";
import {
  commitCompare,
  getBranchLatestCommit,
  getCommitsBatch,
  getFileContent,
  getReleaseDiffChecking,
} from "./git";
import type { AdoWebApi } from "./interfaces";
import {
  createSubscription,
  deleteSubscription,
  getSubscriptions,
} from "./notification";
import {
  getPipelineByRepoName,
  getPipelineRuns,
  getReleasedPipelineRuns,
} from "./pipeline";
import {
  getLatestPullRequestIterations,
  getLatestPullRequestStatus,
  getPullRequestStatuses,
  getPullRequestById,
  getPullRequestMetadataById,
  getPullRequestChangesFiles,
  getPullRequestIterationChangesFiles,
  getPullRequestIterations,
  getPullRequestListByRepoName,
  getPullRequestProperties,
  getPullRequestsByBranchName,
  hasAlreadyCommented,
  isValidPullRequest,
  setPullRequestProperties,
} from "./pull-request";
import {
  createPullRequestStatus,
} from "./pull-request-status";
import {
  addCommentForPR,
  addCommentThreadForPRCode,
  getCommentThreadById,
  getPullRequestThreads,
  updateCommentThreadStatus,
} from "./pull-request-comment";
import { getReleaseWorkItems, queryRatanReleaseIds } from "./release";
import { getRepos } from "./repo";
import {
  createTestCaseWorkItem,
  getTestCaseWorkItems,
  updateTestCaseWorkItem,
} from "./testcase";
import {
  createBulkTestSuites,
  createTestPlan,
  createTestSuite,
  getTestPlanById,
  getTestPointList,
  getTestSuite,
  updateTestPlan,
} from "./testplan";
import {
  createTestRun,
  createTestRunResults,
  createTestRunResultsAttachments,
  getTestRun,
  getTestRunResults,
  queryTestRunResults,
  updateTestRun,
  updateTestRunResults,
} from "./testrun";
import {
  addRelationsToWorkItem,
  getCommonWorkItems,
  getWorkitemsByFields,
} from "./workitem";
import {
  queryWorkitemsByQueryId,
  queryWorkitemsByWiql,
} from "./workitem-query";
import { getSonatypeBuildMetrics } from "./sonatype";
export class AzureDevOps {
  private adoWebApi: AdoWebApi;
  private API_URL = "https://dev.azure.com";
  private API_ORGANIZATION = "sc-ado";
  private API_PROJECT = "FMQPR";
  private API_TOKEN = "";
  private ADO_PROXY_URL = config.ADO_PROXY_URL || "";

  private resolveProxyUrl(proxy: string | undefined) {
    if (proxy === undefined) {
      return this.ADO_PROXY_URL;
    }
    if (proxy.trim().toLowerCase() === "none") {
      return "";
    }
    return proxy;
  }

  constructor({
    proxy,
    organization,
    project,
  }: {
    proxy?: string;
    organization?: string;
    project?: string;
  } = {}) {
    this.ADO_PROXY_URL = this.resolveProxyUrl(proxy);
    if (organization) {
      this.API_ORGANIZATION = organization;
    }
    if (project) {
      this.API_PROJECT = project;
    }
  }

  async connect(token: string) {
    if (!token) {
      console.error("[ado] Token is required for authentication");
      throw new Error("ADO token is required for authentication.");
    }
    try {
      this.API_TOKEN = token;
      const authHandler = vm.getPersonalAccessTokenHandler(this.API_TOKEN);
      const option = this.createRequestOptions();

      const vsts: vm.WebApi = new vm.WebApi(
        this.getServerUrl(),
        authHandler,
        option,
      );
      const connData = await vsts.connect();
      const currentUserName =
        connData.authenticatedUser?.providerDisplayName || "UNKNOWN_USER";
      console.log("[ado] Connected to Azure DevOps", { user: currentUserName });
      this.adoWebApi = vsts;
      return connData;
    } catch (err) {
      console.error("[ado] Connection failed", err);
      throw err;
    }
  }

  getServerUrl() {
    return `${this.API_URL}/${this.API_ORGANIZATION}`;
  }

  getOrganization() {
    return this.API_ORGANIZATION;
  }

  getProjectName() {
    return this.API_PROJECT;
  }

  getAdoToken() {
    return this.API_TOKEN;
  }

  getProxyUrl() {
    return this.ADO_PROXY_URL;
  }

  getAdoClient() {
    return this.adoWebApi;
  }

  private createRequestOptions(): IRequestOptions {
    const option: IRequestOptions = {
      ignoreSslError: true,
    };
    if (this.ADO_PROXY_URL) {
      option.proxy = {
        proxyUrl: this.ADO_PROXY_URL,
      };
    }
    return option;
  }

  getPullRequestListByRepoName = getPullRequestListByRepoName;
  getPullRequestById = getPullRequestById;
  getPullRequestMetadataById = getPullRequestMetadataById;
  getRepos = getRepos;
  getBranchLatestCommit = getBranchLatestCommit;
  getCommitsBatch = getCommitsBatch;
  commitCompare = commitCompare;
  getReleaseDiffChecking = getReleaseDiffChecking;
  getPipelineRuns = getPipelineRuns;
  getReleasedPipelineRuns = getReleasedPipelineRuns;
  getPipelineByRepoName = getPipelineByRepoName;
  getPullRequestsByBranchName = getPullRequestsByBranchName;
  getPullRequestIterations = getPullRequestIterations;
  getLatestPullRequestIterations = getLatestPullRequestIterations;
  getPullRequestIterationChangesFiles = getPullRequestIterationChangesFiles;
  getPullRequestProperties = getPullRequestProperties;
  setPullRequestProperties = setPullRequestProperties;
  getPullRequestChangesFiles = getPullRequestChangesFiles;
  getCodeDiffFromHierarchyQuery = getCodeDiffFromHierarchyQuery;
  isValidPullRequest = isValidPullRequest;
  hasAlreadyCommented = hasAlreadyCommented;
  getLatestPullRequestStatus = getLatestPullRequestStatus;
  getPullRequestStatuses = getPullRequestStatuses;
  getWorkitemsByFields = getWorkitemsByFields;
  getCommonWorkItems = getCommonWorkItems;
  getReleaseWorkItems = getReleaseWorkItems;
  getTestCaseWorkItems = getTestCaseWorkItems;
  addRelationsToWorkItem = addRelationsToWorkItem;
  queryRatanReleaseIds = queryRatanReleaseIds;
  createTestCaseWorkItem = createTestCaseWorkItem;
  updateTestCaseWorkItem = updateTestCaseWorkItem;
  addCommentForPR = addCommentForPR;
  addCommentThreadForPRCode = addCommentThreadForPRCode;
  getCommentThreadById = getCommentThreadById;
  getPullRequestThreads = getPullRequestThreads;
  updateCommentThreadStatus = updateCommentThreadStatus;
  getSubscriptions = getSubscriptions;
  createSubscription = createSubscription;
  deleteSubscription = deleteSubscription;
  createPullRequestStatus = createPullRequestStatus;
  getBuildById = getBuildById;
  getBuildAttachmentContent = getBuildAttachmentContent;
  getBuildAttachments = getBuildAttachments;
  getArtifactsByBuildId = getArtifactsByBuildId;
  getBuildChangesByBuildId = getBuildChangesByBuildId;
  getBuildLogsByBuildId = getBuildLogsByBuildId;
  getBuildPropertiesByBuildId = getBuildPropertiesByBuildId;
  getBuildReportByBuildId = getBuildReportByBuildId;
  getSonatypeBuildMetrics = getSonatypeBuildMetrics;
  queryWorkitemsByQueryId = queryWorkitemsByQueryId;
  queryWorkitemsByWiql = queryWorkitemsByWiql;
  createTestRun = createTestRun;
  getTestRunResults = getTestRunResults;
  queryTestRunResults = queryTestRunResults;
  createTestRunResults = createTestRunResults;
  updateTestRunResults = updateTestRunResults;
  createTestRunResultsAttachments = createTestRunResultsAttachments;
  getTestPlanById = getTestPlanById;
  createTestPlan = createTestPlan;
  updateTestPlan = updateTestPlan;
  getTestSuite = getTestSuite;
  createTestSuite = createTestSuite;
  createBulkTestSuites = createBulkTestSuites;
  getTestRun = getTestRun;
  updateTestRun = updateTestRun;
  getTestPointList = getTestPointList;
  getFileContent = getFileContent;
}
