import {
  type Build,
  BuildResult,
  BuildStatus,
} from "azure-devops-node-api/interfaces/BuildInterfaces.js";
import { html2markdown } from "ratan-markdown-tool";
import type { AdoWebApi, FormattedBuild } from "./interfaces";
import { extractBranchFromSourceBranch } from "./utils";

export async function getBuildById(buildId: number) {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const buildApi = await webApi.getBuildApi();

  try {
    const build = await buildApi.getBuild(projectName, buildId);
    return {
      build,
      formattedBuild: prettifyBuild(build),
    };
  } catch (error) {
    console.error(`Error fetching build with ID ${buildId}:`, error);
    return null;
  }
}

/**
 * get the attachments links
 * @param {string} buildId build id
 * @returns attachments links
 */
export async function getBuildAttachments(buildId: number) {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const buildApi = await webApi.getBuildApi();

  try {
    const attachments = await buildApi.getAttachments(
      projectName,
      buildId,
      "test.report",
    );
    return attachments;
  } catch (error) {
    console.error("Error fetching attachments by ID:", error);
    return [];
  }
}

/**
 * get the attachment content
 * @param {string} buildId build id
 * @param {string} type attachment type
 * @returns {string} attachment content: ;
 */
export async function getBuildAttachmentContent(
  buildId: number,
  type: "testreport" | "securitysummary",
) {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const buildApi = await webApi.getBuildApi();

  let timelineRefName = "";
  let attachmentType = "";
  let attachmentName = "";

  switch (type) {
    case "testreport":
      timelineRefName = "generatetestreport";
      attachmentType = "test.report";
      attachmentName = "rtm.json";
      break;

    case "securitysummary":
      timelineRefName = "generatesecuritysummary";
      attachmentType = "summary-html";
      attachmentName = "security-summary.html";
      break;

    default:
      break;
  }

  try {
    const timeline = await buildApi.getBuildTimeline(projectName, buildId);
    const sortedRecords = timeline.records
      ?.filter((i) => i.refName === timelineRefName)
      .toSorted(
        (a, b) => new Date(b.finishTime).getTime() - new Date(a.finishTime).getTime(),
      );
    const recordId = sortedRecords?.at(0)?.id ?? "";
    const testReportReadableStream = await buildApi.getAttachment(
      projectName,
      buildId,
      `${timeline.id}`,
      recordId,
      attachmentType,
      attachmentName,
    );
    const chunks: Buffer[] = [];
    for await (const chunk of testReportReadableStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const data = Buffer.concat(chunks).toString("utf-8");
    return data;
  } catch (error) {
    console.error("Error fetching attachments by ID:", error);
    return "";
  }
}

export async function getArtifactsByBuildId(buildId: number) {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const buildApi = await webApi.getBuildApi();

  try {
    const artifacts = await buildApi.getArtifacts(projectName, buildId);
    return artifacts;
  } catch (error) {
    console.error(`Error fetching artifacts for build ID ${buildId}:`, error);
    return null;
  }
}

export async function getBuildChangesByBuildId(buildId: number) {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const buildApi = await webApi.getBuildApi();

  try {
    const changes = await buildApi.getBuildChanges(projectName, buildId);
    return changes;
  } catch (error) {
    console.error(`Error fetching changes for build ID ${buildId}:`, error);
    return null;
  }
}

export async function getBuildLogsByBuildId(buildId: number) {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const buildApi = await webApi.getBuildApi();

  try {
    const logs = await buildApi.getBuildLogs(projectName, buildId);
    return logs;
  } catch (error) {
    console.error(`Error fetching logs for build ID ${buildId}:`, error);
    return null;
  }
}

export async function getBuildPropertiesByBuildId(buildId: number) {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const buildApi = await webApi.getBuildApi();

  try {
    const properties = await buildApi.getBuildProperties(projectName, buildId);
    return properties;
  } catch (error) {
    console.error(`Error fetching properties for build ID ${buildId}:`, error);
    return null;
  }
}

export async function getBuildReportByBuildId(buildId: number) {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const buildApi = await webApi.getBuildApi();

  try {
    const report = await buildApi.getBuildReport(projectName, buildId);

    report.content = html2markdown(
      report.content?.replace(/\\r\\n/g, "") ?? "",
    );

    return report;
  } catch (error) {
    console.error(`Error fetching report for build ID ${buildId}:`, error);
    return null;
  }
}

export const prettifyBuild = (build: Build): FormattedBuild => {
  const [repo] = build.definition?.name?.split("_") ?? [];
  return {
    id: build.id,
    buildNumber: build.buildNumber,
    status: BuildStatus[build.status],
    result: BuildResult[build.result],
    startTime: build.startTime?.toISOString(),
    finishTime: build.finishTime?.toISOString(),
    url: build.url,
    sourceBranch: extractBranchFromSourceBranch(build.sourceBranch ?? ""),
    sourceVersion: build.sourceVersion,
    repo,
    requestBy: build.requestedBy?.displayName ?? "",
  };
};
