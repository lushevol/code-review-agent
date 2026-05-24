import type {
  TestPlanCreateParams,
  TestPlanUpdateParams,
  TestSuiteCreateParams,
} from "azure-devops-node-api/interfaces/TestPlanInterfaces.js";
import type {
  AdoWebApi,
  TestPlanType,
  TestPointType,
  TestSuiteType,
} from "./interfaces";
import { dateToDateString } from "./utils";

export async function createTestPlan(
  testPlanCreateParams: TestPlanCreateParams,
): Promise<TestPlanType> {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const testPlanApi = await webApi.getTestPlanApi();
  const testPlan = await testPlanApi.createTestPlan(
    testPlanCreateParams,
    projectName,
  );

  return {
    ...testPlan,
    owner: {
      ...testPlan?.owner,
      userId: testPlan?.owner?.id ?? "",
    },
    updatedBy: {
      ...testPlan?.updatedBy,
      userId: testPlan?.updatedBy?.id ?? "",
    },
    updatedDate: dateToDateString(testPlan?.updatedDate),
    startDate: dateToDateString(testPlan?.startDate),
    endDate: dateToDateString(testPlan?.endDate),
  } satisfies TestPlanType;
}

export async function updateTestPlan(
  testPlanId: number,
  testPlanUpdateParams: TestPlanUpdateParams,
): Promise<TestPlanType> {
  if (!testPlanId) {
    throw new Error("Test plan ID is required to update a test plan.");
  }
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const testPlanApi = await webApi.getTestPlanApi();
  const testPlan = await testPlanApi.updateTestPlan(
    testPlanUpdateParams,
    projectName,
    testPlanId,
  );

  return {
    ...testPlan,
    owner: {
      ...testPlan?.owner,
      userId: testPlan?.owner?.id ?? "",
    },
    updatedBy: {
      ...testPlan?.updatedBy,
      userId: testPlan?.updatedBy?.id ?? "",
    },
    updatedDate: dateToDateString(testPlan.updatedDate),
    startDate: dateToDateString(testPlan.startDate),
    endDate: dateToDateString(testPlan.endDate),
  } satisfies TestPlanType;
}
export async function getTestSuite(
  testPlanId: number,
  testSuiteId: number,
): Promise<TestSuiteType> {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const testPlanApi = await webApi.getTestPlanApi();
  const testSuite = await testPlanApi.getTestSuiteById(
    projectName,
    testPlanId,
    testSuiteId,
  );

  return {
    ...testSuite,
    lastUpdatedBy: {
      ...testSuite?.lastUpdatedBy,
      userId: testSuite?.lastUpdatedBy?.id ?? "",
    },
    lastUpdatedDate: dateToDateString(testSuite.lastUpdatedDate),
    lastPopulatedDate: dateToDateString(testSuite.lastPopulatedDate),
  } satisfies TestSuiteType;
}

export async function createTestSuite(
  testSuiteCreateParams: TestSuiteCreateParams,
  testPlanId: number,
): Promise<TestSuiteType> {
  if (!testPlanId) {
    throw new Error("Test plan ID is required to create a test suite.");
  }
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const testPlanApi = await webApi.getTestPlanApi();
  const testSuite = await testPlanApi.createTestSuite(
    testSuiteCreateParams,
    projectName,
    testPlanId,
  );

  console.log(
    `Test suite created with ID: ${testSuite.id} under test plan ID: ${testPlanId}`,
  );

  return {
    ...testSuite,
    lastUpdatedBy: {
      ...testSuite?.lastUpdatedBy,
      userId: testSuite?.lastUpdatedBy?.id ?? "",
    },
    lastUpdatedDate: dateToDateString(testSuite.lastUpdatedDate),
    lastPopulatedDate: dateToDateString(testSuite.lastPopulatedDate),
  } satisfies TestSuiteType;
}

export async function createBulkTestSuites(
  testSuiteCreateParams: TestSuiteCreateParams[],
  testPlanId: number,
  parentTestSuiteId: number,
): Promise<TestSuiteType[]> {
  if (!testPlanId) {
    throw new Error("Test plan ID is required to create a test suite.");
  }
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const testPlanApi = await webApi.getTestPlanApi();
  const testSuites = await testPlanApi.createBulkTestSuites(
    testSuiteCreateParams,
    projectName,
    testPlanId,
    parentTestSuiteId,
  );

  console.log(
    `Test suites created with IDs: ${testSuites.map((suite) => suite.id).join(", ")} under test plan ID: ${testPlanId}`,
  );

  return (
    testSuites?.map((i) => ({
      ...i,
      lastUpdatedBy: {
        ...i?.lastUpdatedBy,
        userId: i?.lastUpdatedBy?.id ?? "",
      },
      lastUpdatedDate: dateToDateString(i.lastUpdatedDate),
      lastPopulatedDate: dateToDateString(i.lastPopulatedDate),
    })) ?? ([] satisfies TestSuiteType[])
  );
}

export async function getTestPlanById(
  testPlanId: number,
): Promise<TestPlanType> {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const testPlanApi = await webApi.getTestPlanApi();
  const testPlan = await testPlanApi.getTestPlanById(projectName, testPlanId);

  return {
    ...testPlan,
    owner: {
      ...testPlan?.owner,
      userId: testPlan?.owner?.id ?? "",
    },
    updatedBy: {
      ...testPlan?.updatedBy,
      userId: testPlan?.updatedBy?.id ?? "",
    },
    updatedDate: dateToDateString(testPlan.updatedDate),
    startDate: dateToDateString(testPlan.startDate),
    endDate: dateToDateString(testPlan.endDate),
  } satisfies TestPlanType;
}

export async function getTestPointList(
  planId: number,
  suiteId: number,
  testPointIds?: string,
  testCaseId?: string,
): Promise<TestPointType[]> {
  const webApi = this.adoWebApi as AdoWebApi;
  const projectName = this.getProjectName();
  const testPlanApi = await webApi.getTestPlanApi();
  const testPoints = await testPlanApi.getPointsList(
    projectName,
    planId,
    suiteId,
    testPointIds,
    testCaseId,
  );

  return testPoints?.map((i) => ({
    ...i,
    tester: {
      ...i?.tester,
      userId: i?.tester?.id ?? "",
    },
    lastUpdatedBy: {
      ...i?.lastUpdatedBy,
      userId: i?.lastUpdatedBy?.id ?? "",
    },
    lastUpdatedDate: dateToDateString(i.lastUpdatedDate),
    results: {
      ...i.results,
      lastResultDetails: {
        ...i.results.lastResultDetails,
        dateCompleted: dateToDateString(
          i.results.lastResultDetails.dateCompleted,
        ),
      },
    },
    lastResetToActive: dateToDateString(i.lastResetToActive),
  })) satisfies TestPointType[];
}
