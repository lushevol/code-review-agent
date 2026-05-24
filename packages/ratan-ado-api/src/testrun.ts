import type {
  ResultsFilter,
  RunCreateModel,
  RunUpdateModel,
  TestAttachmentRequestModel,
  TestCaseResult,
} from "azure-devops-node-api/interfaces/TestInterfaces.js";
import type {
  AdoWebApi,
  TestAttachmentReferenceType,
  TestRunResultType,
  TestRunType,
} from "./interfaces";
import { dateToDateString } from "./utils";

export async function createTestRun(
  createTestRunParams: RunCreateModel,
): Promise<TestRunType> {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const testApi = await webApi.getTestApi();
  const testRun = await testApi.createTestRun(createTestRunParams, projectName);

  console.log(`Test run created with ID: ${testRun.id}`);
  if (!testRun.id) {
    throw new Error("Failed to create test run: ID is missing.");
  }
  return {
    ...testRun,
    lastUpdatedDate: dateToDateString(testRun.lastUpdatedDate),
    createdDate: dateToDateString(testRun.createdDate),
  } as TestRunType;
}

export async function getTestRun(testRunId: number): Promise<TestRunType> {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const testApi = await webApi.getTestApi();
  const testRun = await testApi.getTestRunById(projectName, testRunId, true);

  return {
    ...testRun,
    owner: {
      ...testRun?.owner,
      userId: testRun?.owner?.id ?? "",
    },
    lastUpdatedBy: {
      ...testRun?.lastUpdatedBy,
      userId: testRun?.lastUpdatedBy?.id ?? "",
    },
    lastUpdatedDate: dateToDateString(testRun.lastUpdatedDate),
    createdDate: dateToDateString(testRun.createdDate),
  } satisfies TestRunType;
}

export async function updateTestRun(
  testRunUpdate: RunUpdateModel,
  testRunId: number,
): Promise<TestRunType> {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const testApi = await webApi.getTestApi();
  const testRun = await testApi.updateTestRun(
    testRunUpdate,
    projectName,
    testRunId,
  );

  return {
    ...testRun,
    owner: {
      ...testRun?.owner,
      userId: testRun?.owner?.id ?? "",
    },
    lastUpdatedBy: {
      ...testRun?.lastUpdatedBy,
      userId: testRun?.lastUpdatedBy?.id ?? "",
    },
    lastUpdatedDate: dateToDateString(testRun.lastUpdatedDate),
    createdDate: dateToDateString(testRun.createdDate),
  } satisfies TestRunType;
}

export async function createTestRunResults(
  results: TestCaseResult[],
  testRunId: number,
): Promise<TestRunResultType[]> {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const testApi = await webApi.getTestApi();
  const testRunResults = await testApi.addTestResultsToTestRun(
    results,
    projectName,
    testRunId,
  );

  return testRunResults.map((testRunResult) => ({
    ...testRunResult,
    lastUpdatedBy: {
      ...testRunResult.lastUpdatedBy,
      userId: testRunResult.lastUpdatedBy?.id ?? "",
    },
  })) satisfies TestRunResultType[];
}

export async function updateTestRunResults(
  results: TestCaseResult[],
  testRunId: number,
): Promise<TestRunResultType[]> {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const testApi = await webApi.getTestApi();
  const testRunResults = await testApi.updateTestResults(
    results,
    projectName,
    testRunId,
  );

  return testRunResults.map((testRunResult) => ({
    ...testRunResult,
    lastUpdatedBy: {
      ...testRunResult.lastUpdatedBy,
      userId: testRunResult.lastUpdatedBy?.id ?? "",
    },
  })) satisfies TestRunResultType[];
}

export async function queryTestRunResults(
  query: ResultsFilter,
): Promise<TestRunResultType[]> {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const testApi = await webApi.getTestResultsApi();
  const testRunResults = await testApi.getTestResultsByQuery(
    {
      resultsFilter: query,
    },
    projectName,
  );
  return testRunResults.results.map((testRunResult) => ({
    ...testRunResult,
    lastUpdatedBy: {
      ...testRunResult.lastUpdatedBy,
      userId: testRunResult.lastUpdatedBy?.id ?? "",
    },
  })) satisfies TestRunResultType[];
}

export async function getTestRunResults(
  testRunId: number,
): Promise<TestRunResultType[]> {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const testApi = await webApi.getTestApi();
  const testRunResults = await testApi.getTestResults(projectName, testRunId);

  return testRunResults.map((testRunResult) => ({
    ...testRunResult,
    lastUpdatedBy: {
      ...testRunResult.lastUpdatedBy,
      userId: testRunResult.lastUpdatedBy?.id ?? "",
    },
  })) satisfies TestRunResultType[];
}

export async function createTestRunResultsAttachments(
  attachmentRequestModel: TestAttachmentRequestModel,
  testRunId: number,
  testCaseResultId: number,
): Promise<TestAttachmentReferenceType> {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const testApi = await webApi.getTestApi();
  const testAttachment = await testApi.createTestResultAttachment(
    attachmentRequestModel,
    projectName,
    testRunId,
    testCaseResultId,
  );

  console.log(
    `Test result attachment created for test run ID: ${testRunId} and test case result ID: ${testCaseResultId}`,
  );

  return testAttachment satisfies TestAttachmentReferenceType;
}
