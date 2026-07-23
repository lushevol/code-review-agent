import { defineStep } from "../../runtime";
import { ParsedMeasuresComponentSchema } from "ratan-sonarqube-api";
import { SonatypeBuildMetricsSchema } from "ratan-ado-api";
import z from "zod";
import { extractAgentConfig } from "../../../bootstrap/session";
import { type CommonRequestContext, PullRequestSchema } from "../../types";
import { NormalizedFindingSchema } from "../../types/finding";
import { withRetry } from "../../utils/retry";
import { getLogger } from "ratan-logger";

type RetryConfig = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
};

type PipelineRunCandidate = {
  id?: number;
};

const PRDetailsInputSchema = z.object({
  prDetails: PullRequestSchema,
  workItemContext: z.string().optional(),
  findings: z.array(NormalizedFindingSchema),
  correlationSummary: z.string(),
  changesSinceLastReview: z.string().optional(),
});

const PRDetailsResultSchema = z.object({
  measures: z
    .union([
      z.object({
        sonarQube: z.object({
          pullRequest: ParsedMeasuresComponentSchema.nullable(),
          targetBranch: ParsedMeasuresComponentSchema.nullable(),
          coverage: z.object({
            line: z.object({
              current: z.number().nullable(),
              baseline: z.number().nullable(),
              delta: z.number().nullable(),
            }),
            branch: z.object({
              current: z.number().nullable(),
              baseline: z.number().nullable(),
              delta: z.number().nullable(),
            }),
          }),
        }),
        sonatype: SonatypeBuildMetricsSchema.nullable(),
      }),
      z.null(),
    ])
    .describe("The SonarQube measures for the pull request"),
});

function toCoverageMetric(current: unknown, baseline: unknown) {
  const currentValue = typeof current === "number" && Number.isFinite(current)
    ? current
    : null;
  const baselineValue = typeof baseline === "number" && Number.isFinite(baseline)
    ? baseline
    : null;

  return {
    current: currentValue,
    baseline: baselineValue,
    delta:
      currentValue === null || baselineValue === null
        ? null
        : Number((currentValue - baselineValue).toFixed(1)),
  };
}

export const sonarqubeMeasures = defineStep({
  id: "sonarqube-measures",
  description: "Fetches SonarQube measures for a pull request",
  inputSchema: PRDetailsInputSchema,
  outputSchema: PRDetailsResultSchema,
  execute: async ({ inputData, requestContext }) => {
    if (!inputData) {
      throw new Error("Input data not found");
    }

    const {
      prDetails: { pullRequestId, repoName, targetBranch, sourceBranch, projectId, pipelineId },
    } = inputData;

    const agentConfig = extractAgentConfig(
      requestContext as unknown as CommonRequestContext,
    );

    const sonarQubeClient = agentConfig.getSonarQubeClient();
    const adoClient = agentConfig.getAdoClient();
    const logger = getLogger("sonarqube-measures");

    try {
      const rootConfig = await agentConfig.getRootConfig();

      const prMeasuresPromise = sonarQubeClient
        ? fetchMeasuresOrNull({
            sonarQubeClient,
            target: pullRequestId,
            repoName,
            retry: rootConfig.retry,
            logger,
            label: `pull request ${pullRequestId}`,
          })
        : Promise.resolve(null);

      const targetMeasuresPromise = sonarQubeClient && targetBranch
        ? fetchMeasuresOrNull({
            sonarQubeClient,
            target: targetBranch,
            repoName,
            retry: rootConfig.retry,
            logger,
            label: `branch ${targetBranch}`,
          })
        : Promise.resolve(null);

      const sonatypePromise = fetchSonatypeMetrics({
        adoClient,
        projectId,
        pipelineId,
        repoName,
        sourceBranch,
        targetBranch,
        retry: rootConfig.retry,
      });

      const [pullRequestMeasures, targetBranchMeasures, sonatype] =
        await Promise.all([prMeasuresPromise, targetMeasuresPromise, sonatypePromise]);

      if (!pullRequestMeasures && !targetBranchMeasures && !sonatype) {
        if (!sonarQubeClient) {
          logger.warn(
            "No SonarQube client available; only Sonatype metrics were attempted. " +
              "Ensure config.sonarQube.url and config.sonarQube.token are set and valid.",
          );
        }
        return { measures: null };
      }

      const measures = {
        sonarQube: {
          pullRequest: pullRequestMeasures,
          targetBranch: targetBranchMeasures,
          coverage: {
            line: toCoverageMetric(
              pullRequestMeasures?.line_coverage,
              targetBranchMeasures?.line_coverage,
            ),
            branch: toCoverageMetric(
              pullRequestMeasures?.branch_coverage,
              targetBranchMeasures?.branch_coverage,
            ),
          },
        },
        sonatype,
      };

      return {
        measures,
      };
    } catch (error) {
      logger.error("Failed to fetch SonarQube measures", {
        error: (error as Error).message,
        stack: (error as Error).stack,
        pullRequestId,
        repoName,
      });
      return {
        measures: null,
      };
    }
  },
});

async function fetchSonatypeMetrics({
  adoClient,
  projectId,
  pipelineId,
  repoName,
  sourceBranch,
  targetBranch,
  retry,
}: {
  adoClient: ReturnType<ReturnType<typeof extractAgentConfig>["getAdoClient"]>;
  projectId?: string;
  pipelineId?: number;
  repoName: string;
  sourceBranch: string;
  targetBranch: string;
  retry: RetryConfig;
}) {
  if (!adoClient) {
    const logger = getLogger("sonarqube-measures");
    logger.warn("No ADO client available; Sonatype metrics will not be fetched.");
    return null;
  }

  try {
    const resolvedPipelineId = pipelineId ?? await resolvePipelineId(adoClient, repoName, retry);
    if (!projectId || !resolvedPipelineId) {
      return null;
    }

    const runs = await resolveCandidatePipelineRuns({
      adoClient,
      repoName,
      targetBranch,
      sourceBranch,
      retry,
    });
    const buildId = runs.find((run) => typeof run.id === "number")?.id;
    if (!buildId) {
      return null;
    }

    return withRetry(
      () => adoClient.getSonatypeBuildMetrics({ projectId, pipelineId: resolvedPipelineId, buildId }),
      retry,
    );
  } catch {
    return null;
  }
}

async function resolvePipelineId(
  adoClient: ReturnType<ReturnType<typeof extractAgentConfig>["getAdoClient"]>,
  repoName: string,
  retry: RetryConfig,
) {
  const pipeline = await withRetry(
    () => adoClient.getPipelineByRepoName(repoName),
    retry,
  );
  return typeof pipeline?.id === "number" ? pipeline.id : undefined;
}

async function resolveCandidatePipelineRuns({
  adoClient,
  repoName,
  targetBranch,
  sourceBranch,
  retry,
}: {
  adoClient: ReturnType<ReturnType<typeof extractAgentConfig>["getAdoClient"]>;
  repoName: string;
  targetBranch: string;
  sourceBranch: string;
  retry: RetryConfig;
}): Promise<PipelineRunCandidate[]> {
  const attempts: Array<() => Promise<unknown[]>> = [
    () => adoClient.getPipelineRuns(repoName, targetBranch, sourceBranch),
    () => adoClient.getPipelineRuns(repoName, targetBranch),
    () => adoClient.getPipelineRuns(repoName),
  ];

  for (const attempt of attempts) {
    const runs = await withRetry(attempt, retry) as PipelineRunCandidate[];
    if (runs.length > 0) {
      return runs;
    }
  }

  return [];
}

async function fetchMeasuresOrNull({
  sonarQubeClient,
  target,
  repoName,
  retry,
  logger,
  label,
}: {
  sonarQubeClient: NonNullable<ReturnType<ReturnType<typeof extractAgentConfig>["getSonarQubeClient"]>>;
  target: number | string;
  repoName: string;
  retry: RetryConfig;
  logger: ReturnType<typeof getLogger>;
  label: string;
}) {
  try {
    return await withRetry(
      () => sonarQubeClient.getMeasures(target, repoName),
      retry,
    );
  } catch (error) {
    logger.warn(`Unable to fetch SonarQube measures for ${label}`, {
      error: (error as Error).message,
      repoName,
    });
    return null;
  }
}
