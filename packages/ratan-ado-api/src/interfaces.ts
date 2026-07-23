import type * as vm from "azure-devops-node-api";
import { CommentThreadStatus } from "azure-devops-node-api/interfaces/GitInterfaces.js";
import { z } from "zod";

export type AdoWebApi = vm.WebApi;

export type ReviewResultJson = {
  approve: boolean;
  errors: Array<{
    file: string;
    line: number;
    severity: string;
    priority: string;
    message: string;
    suggestion?: string;
    suggestion_code?: string;
    confidence_score: number;
  }>;
};

export const AdoPersonSchema = z.object({
  userId: z.string(),
  displayName: z.string().optional(),
  uniqueName: z.string().optional(),
  id: z.string().optional(),
  url: z.string().optional(),
  imageUrl: z.string().optional(),
  descriptor: z.string().optional(),
});
export type AdoPerson = z.infer<typeof AdoPersonSchema>;

export const ApproveStateSchema = z.enum(["Yes", "No"]);
export type ApproveState = z.infer<typeof ApproveStateSchema>;

export const CommonWorkItemTypeSchema = z.object({
  id: z.number(),
  title: z.string(),
  state: z.string(),
  type: z.string(),
  rev: z.number(),
  areaPath: z.string(),
  iterationPath: z.string(),
  description: z.string(),
  assignedTo: AdoPersonSchema,
  comments: z.array(z.string()).optional(),
});
export type CommonWorkItemType = z.infer<typeof CommonWorkItemTypeSchema>;

export const StoryWorkItemTypeSchema = CommonWorkItemTypeSchema.extend({
  acceptanceCriteria: z.string(),
  stepsToReproduce: z.string(),
  severity: z.string(),
  priority: z.string(),
});
export type StoryWorkItemType = z.infer<typeof StoryWorkItemTypeSchema>;

export const ReleaseWorkItemTypeSchema = CommonWorkItemTypeSchema.extend({
  reason: z.string(),
  changeId: z.string(),
  testingtypeinscope: z.array(z.string()),
  closedDate: z.string(),
  securityChampionApproval: ApproveStateSchema,
  securityChampionReviewer: AdoPersonSchema,
  poReviewer: AdoPersonSchema,
  poApproval: ApproveStateSchema,
  tsoReviewer: AdoPersonSchema,
  tsoApproval: ApproveStateSchema,
  tsuoReviewer: AdoPersonSchema,
  tsuoApproval: ApproveStateSchema,
  deploymentComponents: z.array(z.string()),
  deploymentComponentsPretty: z.array(
    z.object({
      repo: z.string(),
      command: z.string(),
    }),
  ),
  latestPipelineRuns: z.array(
    z.object({
      repo: z.string(),
      command: z.string(),
      buildId: z.number(),
      buildUrl: z.string(),
    }),
  ),
  descriptionofchangeincludingtechnicaldetails: z.string(),
  plannedReleaseDate: z.string(),
  actualReleaseDate: z.string(),
  volumeoftransactionsaffectedorcreatedbychange: z.string(),
  rationaleforNotdoingPerformanceTesting: z.string(),
  rationaleforNotdoingotherMandatoryTestTypes: z.string(),
  releasePTPerformedon: z.string(),
  releasePTPlanDocumentLink: z.string(),
  releasePTReportDocumentLink: z.string(),
  relatedWorkitems: z.array(z.number()),
  testedByWorkitems: z.array(z.number()),
  storiesLinked: z.array(z.number()),
  applicableSecurityControls: z.array(z.string()),
  releaseApproach: z.string(),
  natureoftheChange: z.string(),
});
export type ReleaseWorkItemType = z.infer<typeof ReleaseWorkItemTypeSchema>;

const DateTypeSchema = z.string();

export const TestCaseWorkItemTypeSchema = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string(),
  assignedTo: AdoPersonSchema,
  createdDate: z.string().optional(),
  createdBy: AdoPersonSchema,
  type: z.literal("Test Case"),
  areaPath: z.string(),
  teamProject: z.string(),
  state: z.string(),
  priority: z.string(),
  steps: z.string(),
  expectation: z.string(),
  tags: z.string(),
  testType: z.string(),
  automationStatus: z.string(),
  automatedTestType: z.string(),
  automatedTestId: z.string(),
  automatedTestStorage: z.string(),
  automatedTestName: z.string(),
  messageBanner: z.string(),
  relations: z.array(
    z.object({
      rel: z.string(),
      url: z.string(),
      attributes: z.object({
        name: z.string(),
        comment: z.string().optional(),
        isLocked: z.boolean(),
      }),
    }),
  ),
});

export type TestCaseWorkItemType = z.infer<typeof TestCaseWorkItemTypeSchema>;

export const TestPlanTypeSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().optional(),
  revision: z.number().optional(),
  areaPath: z.string().optional(),
  iteration: z.string().optional(),
  state: z.string().optional(),
  owner: AdoPersonSchema,
  rootSuite: z.object({
    id: z.number(),
    name: z.string(),
  }),
  updatedDate: DateTypeSchema,
  updatedBy: AdoPersonSchema,
  startDate: DateTypeSchema,
  endDate: DateTypeSchema,
});

export type TestPlanType = z.infer<typeof TestPlanTypeSchema>;

export const TestSuiteTypeSchema = z.object({
  id: z.number(),
  name: z.string(),
  suiteType: z.number().optional(),
  requirementId: z.number().optional(),
  parentSuite: z
    .object({
      id: z.number(),
      name: z.string(),
    })
    .optional(),
  inheritDefaultConfigurations: z.boolean().optional(),
  plan: z.object({
    id: z.number(),
    name: z.string(),
  }),
  revision: z.number().optional(),
  lastPopulatedDate: DateTypeSchema,
  lastUpdatedBy: AdoPersonSchema,
  lastUpdatedDate: DateTypeSchema,
});

export type TestSuiteType = z.infer<typeof TestSuiteTypeSchema>;

export const TestPointTypeSchema = z.object({
  id: z.number(),
  tester: AdoPersonSchema,
  configuration: z.object({
    id: z.number(),
    name: z.string(),
  }),
  isAutomated: z.boolean().optional(),
  testPlan: z.object({
    id: z.number(),
    name: z.string(),
  }),
  testSuite: z.object({
    id: z.number(),
    name: z.string(),
  }),
  lastUpdatedBy: AdoPersonSchema,
  lastUpdatedDate: DateTypeSchema,
  results: z.object({
    lastResultDetails: z.object({
      duration: z.number().optional(),
      dateCompleted: DateTypeSchema,
      runBy: z
        .object({
          displayName: z.string().nullable(),
          id: z.string().optional(),
        })
        .optional(),
    }),
    state: z.number().optional(),
    outcome: z.number(),
  }),
  lastResetToActive: DateTypeSchema,
  isActive: z.boolean(),
  testCaseReference: z.object({
    id: z.number(),
    name: z.string(),
    state: z.string().optional(),
  }),
});

export type TestPointType = z.infer<typeof TestPointTypeSchema>;

export const TestRunTypeSchema = z.object({
  id: z.number(),
  name: z.string(),
  url: z.string(),
  isAutomated: z.boolean(),
  iteration: z.string().optional(),
  owner: AdoPersonSchema,
  project: z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
  state: z.string().optional(),
  plan: z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
      url: z.string().optional(),
    })
    .optional(),
  postProcessState: z.string().optional(),
  totalTests: z.number().optional(),
  incompleteTests: z.number().optional(),
  notApplicableTests: z.number().optional(),
  passedTests: z.number().optional(),
  unanalyzedTests: z.number().optional(),
  createdDate: DateTypeSchema,
  lastUpdatedDate: DateTypeSchema,
  lastUpdatedBy: AdoPersonSchema,
  revision: z.number().optional(),
  webAccessUrl: z.string().optional(),
});

export type TestRunType = z.infer<typeof TestRunTypeSchema>;

export const TestRunResultTypeSchema = z.object({
  id: z.number().optional(),
  outcome: z.string().optional(),
  testRun: z
    .object({
      id: z.string().optional(),
    })
    .optional(),
  priority: z.number().optional(),
  url: z.string().optional(),
  lastUpdatedBy: AdoPersonSchema,
});

export type TestRunResultType = z.infer<typeof TestRunResultTypeSchema>;

export const TestAttachmentReferenceTypeSchema = z.object({
  id: z.number(),
  url: z.string(),
});

export type TestAttachmentReferenceType = z.infer<
  typeof TestAttachmentReferenceTypeSchema
>;

export const WorkitemsWithSummarySchema = z.object({
  summary: z.string(),
  workItemId: z.number(),
  state: z.string(),
  title: z.string(),
  type: z.string(),
  description: z.string(),
  acceptanceCriteria: z.string(),
  comments: z.array(z.string()),
});
export type WorkitemsWithSummary = z.infer<typeof WorkitemsWithSummarySchema>;

export const BuildAttachmentTypeSchema = z.literal("test.report");
export type BuildAttachmentType = z.infer<typeof BuildAttachmentTypeSchema>;

export const FormattedBuildSchema = z.object({
  id: z.number(),
  buildNumber: z.string(),
  status: z.string(),
  result: z.string(),
  startTime: z.string(),
  finishTime: z.string(),
  url: z.string(),
  sourceBranch: z.string(),
  sourceVersion: z.string(),
  repo: z.string(),
  requestBy: z.string(),
});
export type FormattedBuild = z.infer<typeof FormattedBuildSchema>;

export const CommentSchema = z.object({
  content: z.string(),
  author: AdoPersonSchema,
});

export const CommentThreadSchema = z.object({
  id: z.number(),
  comments: z.array(CommentSchema),
  status: z.enum(CommentThreadStatus),
});

export type CommentThread = z.infer<typeof CommentThreadSchema>;

const TestExecutionCountByTypeSchema = z.object({
  PASSED: z.number(),
  FAILED: z.number(),
  NO_EXECUTION: z.number(),
  BLOCKED: z.number(),
  DEFERRED: z.number(),
});

export const TestExecutionStatusStatsSchema = z.object({
  totalCount: z.number(),
  countByType: TestExecutionCountByTypeSchema,
});

export type TestExecutionStatusStats = z.infer<
  typeof TestExecutionStatusStatsSchema
>;

const DefectCountByTypeSchema = z.object({
  OPEN: z.number(),
  CLOSED: z.number(),
  IN_PROGRESS: z.number(),
});

export const DefectStatusStatsSchema = z.object({
  totalCount: z.number(),
  countByType: DefectCountByTypeSchema,
});

export type DefectStatusStats = z.infer<typeof DefectStatusStatsSchema>;

const CountByType2Schema = z.object({
  OPEN: z.number(),
  IN_PROGRESS: z.number(),
  CLOSED: z.number(),
});

const DefectSeverityStatsCountSchema = z.object({
  totalCount: z.number(),
  countByType: CountByType2Schema,
  outstandingCount: z.number(),
});

const DefectSeverityStatsSchema = z.object({
  CRITICAL: DefectSeverityStatsCountSchema,
  HIGH: DefectSeverityStatsCountSchema,
  MEDIUM: DefectSeverityStatsCountSchema,
  LOW: DefectSeverityStatsCountSchema,
});

const TestEnvironmentSummarySchema = z.object({
  name: z.string(),
  deploymentType: z.string(),
  appComponents: z.string(),
});

const ComplianceStatusDetailSchema = z.object({
  status: z.string(),
  errors: z.array(z.any()),
  warnings: z.array(z.string()),
});

const TestResultEvidenceSchema = z.object({
  hasAttachment: z.boolean(),
  hasComment: z.boolean(),
});

const TestPlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  permalink: z.string(),
});

const TestSuiteSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const TestCoverageSchema = z.object({
  id: z.string(),
  name: z.string(),
  executionType: z.string(),
  testType: z.string(),
  testingTool: z.string(),
  status: z.string(),
  permalink: z.string(),
  testPlan: TestPlanSchema.optional(),
  testSuite: TestSuiteSchema.optional(),
  executionTime: z.string(),
  executedBy: z.string(),
  testRunId: z.string(),
  testResultId: z.string(),
  testResultPermalink: z.string(),
  testResultEvidence: TestResultEvidenceSchema,
  regression: z.boolean(),
  requirementIds: z.array(z.string()).optional(),
});

const DefectCoverageSchema = z.object({
  id: z.string(),
  name: z.string(),
  assignee: z.string(),
  permalink: z.string(),
  status: z.string(),
  severity: z.string(),
  priority: z.number(),
});

const RequirementCoverageSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  assignee: z.string(),
  permalink: z.string(),
  testCaseIds: z.array(z.string()),
  defectIds: z.array(z.any()),
  testExecutionStatusStats: TestExecutionStatusStatsSchema,
  defectStatusStats: DefectStatusStatsSchema,
});

const TestReportReleaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  permalink: z.string(),
  testingTypes: z.array(z.string()),
  rationaleForNotDoingPt: z.string(),
  rationaleForNotDoingMandatoryTestings: z.string(),
  catalystRelease: z.boolean(),
});

const NonRegressionTestExecStatusStatsSchema = z.object({
  SYSTEM_TEST: TestExecutionStatusStatsSchema,
  ACCEPTANCE_TEST: TestExecutionStatusStatsSchema,
});

export const TestReportSchema = z.object({
  version: z.string(),
  release: TestReportReleaseSchema,
  requirementCoverages: z.array(RequirementCoverageSchema),
  testCoverages: z.array(TestCoverageSchema),
  defectCoverages: z.array(DefectCoverageSchema),
  nonRegressionTestExecStatusStats: NonRegressionTestExecStatusStatsSchema,
  regressionTestExecStatusStats: TestExecutionStatusStatsSchema,
  defectSeverityStats: DefectSeverityStatsSchema,
  testEnvironmentSummaries: z.array(TestEnvironmentSummarySchema),
  updatedAt: z.string(),
  checksum: z.string(),
  complianceStatusDetail: ComplianceStatusDetailSchema,
});

export type TestReport = z.infer<typeof TestReportSchema>;

export const AdoPullRequestReviewerSchema = z.object({
  hasDeclined: z.boolean().optional(),
  isFlagged: z.boolean().optional(),
  isReapprove: z.boolean().optional(),
  isRequired: z.boolean().optional(),
  reviewerUrl: z.string().optional(),
  vote: z.number().optional(),
});
export type AdoPullRequestReviewer = z.infer<
  typeof AdoPullRequestReviewerSchema
>;

export const AdoPullRequestCommentSchema = z.object({
  content: z.string(),
  author: AdoPersonSchema,
});
export type AdoPullRequestComment = z.infer<typeof AdoPullRequestCommentSchema>;

export const AdoPullRequestCommentThreadSchema = z.object({
  id: z.number(),
  status: z.number(),
  comments: z.array(AdoPullRequestCommentSchema),
});
export type AdoPullRequestCommentThread = z.infer<
  typeof AdoPullRequestCommentThreadSchema
>;

export const AdoGitCommitRefSchema = z.object({
  commitId: z.string(),
});

export const CodeChangeSchema = z.object({
  newFilePath: z.string(),
  oldFilePath: z.string(),
  changeType: z.string(),
  blocks: z.array(
    z.object({
      changeType: z.number(),
      oLine: z.number(),
      oLinesCount: z.number(),
      mLine: z.number(),
      mLinesCount: z.number(),
      oLines: z.array(z.string()), // original lines
      mLines: z.array(z.string()), // modified lines
      truncatedBefore: z.boolean().optional(),
      truncatedAfter: z.boolean().optional(),
    }),
  ),
  changes: z.string(),
});
export const AdoPullRequestSchema = z.object({
  repoId: z.string(),
  repoName: z.string(),
  repoUrl: z.string(),
  projectName: z.string(),
  pullRequestId: z.number(),
  latestTargetCommitId: z.string(),
  latestSourceCommitId: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.number(),
  authorName: z.string(),
  authorId: z.string(),
  creationDate: z.string(),
  sourceRefName: z.string(),
  targetRefName: z.string(),
  sourceBranch: z.string(),
  targetBranch: z.string(),
  // commits: z.array(AdoGitCommitRefSchema),
  reviewers: z.array(AdoPullRequestReviewerSchema),
  latestIterationId: z.number().optional(),
  workItemIds: z.array(z.number()),
  commentThreads: z.array(AdoPullRequestCommentThreadSchema),
  codeDiffs: z.string(),
  codeDiffsArray: z.array(CodeChangeSchema),
});
export type AdoPullRequest = z.infer<typeof AdoPullRequestSchema>;

export const AdoPullRequestMetadataSchema = z.object({
  projectId: z.string().optional(),
  pipelineId: z.number().optional(),
  repoId: z.string(),
  repoName: z.string(),
  cloneUrl: z.string().url(),
  sshUrl: z.string().optional(),
  sourceRepoId: z.string(),
  sourceRepoName: z.string(),
  sourceCloneUrl: z.string().url(),
  sourceSshUrl: z.string().optional(),
  projectName: z.string(),
  pullRequestId: z.number(),
  latestTargetCommitId: z.string(),
  latestSourceCommitId: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.number(),
  isDraft: z.boolean(),
  authorName: z.string(),
  authorId: z.string(),
  creationDate: z.string(),
  sourceRefName: z.string(),
  targetRefName: z.string(),
  sourceBranch: z.string(),
  targetBranch: z.string(),
  reviewers: z.array(AdoPullRequestReviewerSchema),
});
export type AdoPullRequestMetadata = z.infer<
  typeof AdoPullRequestMetadataSchema
>;

export const SonatypeBuildMetricsSchema = z.object({
  __etag: z.number().optional(),
  appId: z.string().optional(),
  stage: z.string().optional(),
  iqUrl: z.string().optional(),
  reportUrl: z.string().optional(),
  componentCritical: z.number(),
  componentSevere: z.number(),
  componentModerate: z.number(),
  legacyViolations: z.number().optional(),
  affectedComponents: z.number().optional(),
  totalViolations: z.number().optional(),
  totalComponents: z.number().optional(),
  meta: z
    .object({
      projectId: z.string().optional(),
      buildId: z.number().optional(),
      buildStatus: z.number().optional(),
      buildNumber: z.string().optional(),
      buildQueued: z.string().optional(),
      buildStarted: z.string().optional(),
    })
    .optional(),
  id: z.string().optional(),
});

export type SonatypeBuildMetrics = z.infer<typeof SonatypeBuildMetricsSchema>;

const AdoProjectTypeSchema = z.object({
  abbreviation: z.string().optional(),
  defaultTeamImageUrl: z.string().optional(),
  description: z.string().optional(),
  id: z.string().optional(),
  lastUpdateTime: z.string().optional(),
  name: z.string().optional(),
  revision: z.number().optional(),
  state: z.any().optional(),
  url: z.string().optional(),
  visibility: z.any().optional(),
});

export type AdoProject = z.infer<typeof AdoProjectTypeSchema>;

const AdoRepositoryTypeSchema = z.object({
  creationDate: z.string().optional(),
  defaultBranch: z.string().optional(),
  id: z.string().optional(),
  isDisabled: z.boolean().optional(),
  isFork: z.boolean().optional(),
  isInMaintenance: z.boolean().optional(),
  name: z.string().optional(),
  project: AdoProjectTypeSchema,
  remoteUrl: z.string().optional(),
  size: z.number().optional(),
  sshUrl: z.string().optional(),
  url: z.string().optional(),
  validRemoteUrls: z.array(z.string()).optional(),
  webUrl: z.string().optional(),
});

export type AdoRepository = z.infer<typeof AdoRepositoryTypeSchema>;
