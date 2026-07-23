import { defineStep } from "../../runtime";
import z from "zod";
import { FindingStore } from "finding-store";
import { extractAgentConfig } from "../../../bootstrap/session";
import { type CommonRequestContext, PullRequestSchema } from "../../types";
import { NormalizedFindingSchema } from "../../types/finding";
import { CODE_REVIEW_AGENT_LATEST_REVIEW_ID } from "../../utils/const";
import {
  evaluatePostableFindings,
  indexPreviouslyLinkedFindings,
} from "../scanners/finding-eligibility";

const REVIEW_SUMMARY_MARKER = "<!-- pr-guardian:review-summary -->";
const LEGACY_REVIEW_MARKER = "Ratan Code Review Agent";
const CLOSED_THREAD_STATUS = 4;
const FIXED_THREAD_STATUS = 2;

type Finding = z.infer<typeof NormalizedFindingSchema>;

type PullRequestComment = {
  content?: string;
  id?: number;
  isDeleted?: boolean;
};

type PullRequestThread = {
  comments?: PullRequestComment[];
  id?: number;
  isDeleted?: boolean;
  threadContext?: unknown;
};

const CommentInputSchema = z.object({
  prDetails: PullRequestSchema,
  findings: z.array(NormalizedFindingSchema),
  correlationSummary: z.string(),
  changesSinceLastReview: z.string().optional(),
  reviewSummary: z.string(),
  reviewExecutionStatus: z.enum(["complete", "incomplete"]),
  reviewMetadata: z.record(z.string(), z.unknown()),
  measures: z.union([z.any(), z.null()]),
  mergeDecision: z.enum(["allowed", "blocked", "pending"]),
  createdWorkItems: z.number(),
  blockerDetails: z
    .array(
      z.object({
        category: z.string(),
        severity: z.enum(["error", "warning"]),
        message: z.string(),
        passed: z.boolean(),
      }),
    )
    .optional(),
});

const CodeReviewResultSchema = z.object({
  mainCommentId: z.number().describe("The ID of the main comment added"),
  codeCommentIds: z
    .array(z.number())
    .describe("The IDs of the code comments added"),
});

function priorityForFinding(finding: Finding): string {
  if (finding.severity === "critical") return "P0";
  if (finding.severity === "high") return "P1";
  if (finding.severity === "medium") return "P2";
  return "P3";
}

function conciseFindingTitle(title: string): string {
  const normalized = title.replace(/\s+/g, " ").trim();
  const sentenceEnd = normalized.search(/[.!?](?:\s|$)/);
  if (sentenceEnd >= 40 && sentenceEnd < normalized.length - 1) {
    return escapeHeadingMarkdown(normalized.slice(0, sentenceEnd + 1));
  }
  if (normalized.length <= 120) return escapeHeadingMarkdown(normalized);
  return escapeHeadingMarkdown(`${normalized.slice(0, 117).trimEnd()}…`);
}

function escapeHeadingMarkdown(value: string): string {
  return value.replace(/([\\`*_{}\[\]<>])/g, "\\$1");
}

export function formatInlineFinding(finding: Finding): string {
  const heading = `### ${priorityForFinding(finding)} · ${finding.severity.toUpperCase()} — ${conciseFindingTitle(finding.title)}`;
  const suggestion = finding.remediation
    ? `\n\n**Suggested fix:**\n\n\`\`\`\n${finding.remediation}\n\`\`\``
    : "";

  return `${heading}\n\n${finding.description}${suggestion}\n\nUseful? Reply with 👍.`;
}

export function formatReviewConclusion({
  findings,
  latestSourceCommitId,
  measures,
  mergeDecision,
  blockerDetails,
  prDescription,
  changesSinceLastReview,
}: {
  findings: Finding[];
  latestSourceCommitId: string;
  measures: unknown;
  mergeDecision: "allowed" | "blocked" | "pending";
  blockerDetails?: Array<{
    category: string;
    severity: string;
    message: string;
    passed: boolean;
  }>;
  prDescription?: string;
  changesSinceLastReview?: string;
}): string {
  const openFindings = findings.filter((finding) => finding.resolution === "open");
  const blockingCount = openFindings.filter((finding) => finding.blocking).length;
  const nonBlockingCount = openFindings.length - blockingCount;
  const reviewedCommit = latestSourceCommitId.slice(0, 10);

  let statusHeading: string;
  let statusIcon: string;
  let summaryLines: string[];
  if (mergeDecision === "blocked") {
    const failedGates = (blockerDetails ?? []).filter((b) => !b.passed);
    statusIcon = "❌";
    statusHeading = "Changes requested";
    summaryLines = [
      `${failedGates.length} policy violation${failedGates.length === 1 ? "" : "s"} must be resolved before merge.`,
    ];
  } else if (mergeDecision === "pending") {
    statusIcon = "⚠️";
    statusHeading = "Review incomplete";
    summaryLines = ["Automated review did not finish. Manual review is required."];
  } else if (nonBlockingCount > 0) {
    statusIcon = "✅";
    statusHeading = "All checks passed";
    summaryLines = [
      `${nonBlockingCount} non-blocking suggestion${nonBlockingCount === 1 ? "" : "s"} noted inline — no blocking violations.`,
    ];
  } else {
    statusIcon = "✅";
    statusHeading = "All checks passed";
    summaryLines = ["No violations found."];
  }

  // Build sections — each ends with "" for spacing, trimmed at the join
  const sections: string[] = [
    REVIEW_SUMMARY_MARKER,
    "## PR Guardian Review",
    "",
    `### ${statusIcon} ${statusHeading}`,
    "",
    "**Policy**",
    ...summaryLines.map((l) => `- ${l}`),
    "",
  ];

  // Quality gates section — shown only when blockerDetails was provided
  if (blockerDetails && blockerDetails.length > 0) {
    sections.push("**Quality gates**");
    for (const gate of blockerDetails) {
      const icon = gate.passed ? "✅" : "❌";
      sections.push(`- ${icon} ${gate.message}`);
    }
    sections.push("");
  }

  // PR description section — shown only when provided and non-empty
  if (prDescription && prDescription.trim().length > 0) {
    sections.push(
      "**PR Description**",
      "",
      prDescription.trim(),
      "",
    );
  }

  const codeQualityLines = formatCodeQualityLines(measures);
  const cveLines = formatCveLines(measures);

  if (codeQualityLines.length > 0) {
    sections.push("**Code Quality**", ...codeQualityLines, "");
  }

  if (cveLines.length > 0) {
    sections.push("**CVEs**", ...cveLines, "");
  }

  // Security hotspots — show when available from SonarQube PR measures
  const securityHotspots = formatSecurityHotspots(measures);
  if (securityHotspots !== null) {
    sections.push(securityHotspots, "");
  }

  if (changesSinceLastReview && changesSinceLastReview.trim().length > 0) {
    sections.push(changesSinceLastReview);
  }

  sections.push(
    "**Review metadata**",
    `- Reviewed commit: \`${reviewedCommit}\``,
  );

  return sections.join("\n");
}

/** Returns bullet-point lines for the Code Quality section, or an empty array if no data. */
function formatCodeQualityLines(measures: unknown): string[] {
  if (!measures || typeof measures !== "object") return [];

  const values = measures as Record<string, unknown>;

  // Enhanced format (from sonarqube-measures step with coverage deltas + PR measures)
  if ("sonarQube" in values) {
    return formatEnhancedCodeQualityLines(values);
  }

  // Legacy simple measures format (flat keys, no branch or delta data)
  const metric = (name: string, suffix = "") => {
    const value = values[name];
    return typeof value === "number" && Number.isFinite(value)
      ? `${value}${suffix}`
      : null;
  };

  const cov = metric("coverage", "%");
  const lines: string[] = [];
  if (cov !== null) lines.push(`- **Line coverage:** ${cov}`);
  for (const [label, key] of [["New bugs", "new_bugs"], ["New vulnerabilities", "new_vulnerabilities"], ["New code smells", "new_code_smells"]] as const) {
    const v = metric(key);
    lines.push(`- **${label}:** \`${v ?? "N/A"}\``);
  }
  return lines;
}

function formatEnhancedCodeQualityLines(values: Record<string, unknown>): string[] {
  const sonarQube =
    values.sonarQube && typeof values.sonarQube === "object"
      ? values.sonarQube as Record<string, unknown>
      : {};
  const pullRequest =
    sonarQube.pullRequest && typeof sonarQube.pullRequest === "object"
      ? sonarQube.pullRequest as Record<string, unknown>
      : {};
  const coverage =
    sonarQube.coverage && typeof sonarQube.coverage === "object"
      ? sonarQube.coverage as Record<string, unknown>
      : {};

  const trend = (metric: unknown) => {
    if (!metric || typeof metric !== "object") return null;
    const entry = metric as Record<string, unknown>;
    const current = typeof entry.current === "number" ? entry.current : null;
    const delta = typeof entry.delta === "number" ? entry.delta : null;
    if (current === null) return null;
    if (delta === null || delta === 0) return `${current}%`;
    return `${current}% ${delta > 0 ? "↑" : "↓"}${Math.abs(delta)}%`;
  };

  const count = (source: Record<string, unknown>, name: string) => {
    const value = source[name];
    return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
  };

  const lines: string[] = [];

  const lineCov = trend(coverage.line);
  const branchCov = trend(coverage.branch);
  if (lineCov !== null) lines.push(`- **Line coverage:** ${lineCov}`);
  if (branchCov !== null) lines.push(`- **Branch coverage:** ${branchCov}`);

  lines.push(
    `- **New bugs:** \`${count(pullRequest, "new_bugs") ?? "N/A"}\``,
    `- **New vulnerabilities:** \`${count(pullRequest, "new_vulnerabilities") ?? "N/A"}\``,
    `- **New code smells:** \`${count(pullRequest, "new_code_smells") ?? "N/A"}\``,
  );

  return lines;
}

/** Returns CVEs bullet-point section lines, or empty array if no Sonatype data. */
function formatCveLines(measures: unknown): string[] {
  if (!measures || typeof measures !== "object") return [];

  const values = measures as Record<string, unknown>;
  const sonatype =
    values.sonatype && typeof values.sonatype === "object"
      ? values.sonatype as Record<string, unknown>
      : {};

  const critical = typeof sonatype.componentCritical === "number" ? sonatype.componentCritical : null;
  const severe = typeof sonatype.componentSevere === "number" ? sonatype.componentSevere : null;
  const moderate = typeof sonatype.componentModerate === "number" ? sonatype.componentModerate : null;

  if (critical === null && severe === null && moderate === null) return [];

  const lines: string[] = [];
  lines.push(critical !== null ? `- 🔴 **Critical:** ${critical}` : "- **Critical:** 0");
  if (severe !== null) lines.push(`- **Severe:** ${severe}`);
  if (moderate !== null) lines.push(`- **Moderate:** ${moderate}`);
  return lines;
}

function formatSecurityHotspots(measures: unknown): string | null {
  if (!measures || typeof measures !== "object") return null;
  const values = measures as Record<string, unknown>;
  const sonarQube =
    values.sonarQube && typeof values.sonarQube === "object"
      ? values.sonarQube as Record<string, unknown>
      : {};
  const pullRequest =
    sonarQube.pullRequest && typeof sonarQube.pullRequest === "object"
      ? sonarQube.pullRequest as Record<string, unknown>
      : {};

  const hotspots = pullRequest.new_security_hotspots;
  const count = typeof hotspots === "number" && Number.isFinite(hotspots) ? hotspots : null;
  if (count === null) return null;

  return `**Security hotspots:** \`${count}\` new hotspot${count === 1 ? "" : "s"} introduced`;
}

function isReviewSummaryThread(thread: PullRequestThread): boolean {
  if (thread.isDeleted || thread.threadContext) return false;
  const content = thread.comments?.find((comment) => !comment.isDeleted)?.content ?? "";
  return content.includes(REVIEW_SUMMARY_MARKER) ||
    (content.includes(LEGACY_REVIEW_MARKER) &&
      (content.includes("### Conclusion:") || content.includes("### PR Description:")));
}

async function upsertReviewConclusion({
  adoClient,
  content,
  pullRequestId,
  repoName,
}: {
  adoClient: ReturnType<ReturnType<typeof extractAgentConfig>["getAdoClient"]>;
  content: string;
  pullRequestId: number;
  repoName: string;
}): Promise<{ id?: number }> {
  const threads = (await adoClient.getPullRequestThreads(
    repoName,
    pullRequestId,
  )) as PullRequestThread[];
  const summaries = threads
    .filter(isReviewSummaryThread)
    .filter((thread) => thread.id !== undefined)
    .sort((left, right) => (left.id ?? 0) - (right.id ?? 0));
  const webApi = adoClient.getAdoClient();
  const gitApi = await webApi.getGitApi();
  const projectName = adoClient.getProjectName();
  const created = await gitApi.createThread(
    {
      comments: [{ content }],
      status: CLOSED_THREAD_STATUS,
    },
    repoName,
    pullRequestId,
    projectName,
  );

  for (const duplicate of summaries) {
    if (duplicate.id === undefined) continue;
    for (const comment of duplicate.comments ?? []) {
      if (comment.id === undefined || comment.isDeleted) continue;
      await gitApi.deleteComment(
        repoName,
        pullRequestId,
        duplicate.id,
        comment.id,
        projectName,
      );
    }
  }

  return { id: created.id };
}

async function refreshLinkedInlineComments({
  adoClient,
  findings,
  links,
  projectName,
  pullRequestId,
  repoId,
  storedFindings,
}: {
  adoClient: ReturnType<ReturnType<typeof extractAgentConfig>["getAdoClient"]>;
  findings: Finding[];
  links: Array<{ findingId: string; threadId: number }>;
  projectName: string;
  pullRequestId: number;
  repoId: string;
  storedFindings: Array<{ id: string; contentHash: string }>;
}): Promise<void> {
  const gitApi = await adoClient.getAdoClient().getGitApi();

  for (const finding of findings) {
    const storedFinding = storedFindings.find((candidate) =>
      candidate.id === finding.id || candidate.contentHash === finding.contentHash
    );
    const link = links.find((candidate) => candidate.findingId === storedFinding?.id);
    if (!link) continue;

    try {
      const thread = await adoClient.getCommentThreadById(
        repoId,
        pullRequestId,
        link.threadId,
      ) as PullRequestThread;
      const comment = thread.comments?.find(
        (candidate) => !candidate.isDeleted && candidate.id !== undefined,
      );
      if (comment?.id === undefined) continue;
      await gitApi.updateComment(
        { content: formatInlineFinding(finding) },
        repoId,
        pullRequestId,
        link.threadId,
        comment.id,
        projectName,
      );
    } catch (error) {
      console.error(
        `[comment-review-results] Failed to refresh linked thread ${link.threadId}: ${(error as Error).message}`,
      );
    }
  }
}

async function closeResolvedInlineComments({
  adoClient,
  links,
  pullRequestId,
  repoId,
  storedFindings,
}: {
  adoClient: ReturnType<ReturnType<typeof extractAgentConfig>["getAdoClient"]>;
  links: Array<{ findingId: string; threadId: number }>;
  pullRequestId: number;
  repoId: string;
  storedFindings: Array<{
    id: string;
    resolution: string;
    supersedesFindingId: string | null;
    resolvedByCommitHash: string | null;
  }>;
}): Promise<void> {
  const hasResolvedDescendant = (findingId: string) => {
    const pending = [findingId];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const currentId = pending.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      const current = storedFindings.find((finding) => finding.id === currentId);
      if (current?.resolution === "resolved") return true;
      pending.push(
        ...storedFindings
          .filter((finding) => finding.supersedesFindingId === currentId)
          .map((finding) => finding.id),
      );
    }
    return false;
  };
  const resolvedFindingIds = new Set(
    storedFindings
      .filter((finding) => hasResolvedDescendant(finding.id))
      .map((finding) => finding.id),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let gitApi: any;
  let projectName: string | undefined;
  try {
    const webApi = adoClient.getAdoClient();
    gitApi = await webApi.getGitApi();
    projectName = adoClient.getProjectName();
  } catch {
    // gitApi not available — gracefully skip reply comments
  }

  for (const link of links) {
    if (!resolvedFindingIds.has(link.findingId)) continue;
    try {
      await adoClient.updateCommentThreadStatus(
        repoId,
        pullRequestId,
        link.threadId,
        FIXED_THREAD_STATUS,
      );
    } catch (error) {
      console.error(
        `[comment-review-results] Failed to close resolved thread ${link.threadId}: ${(error as Error).message}`,
      );
      continue;
    }

    // Add a reply comment with the resolving commit hash
    const stored = storedFindings.find((f) => f.id === link.findingId);
    if (stored?.resolvedByCommitHash && gitApi) {
      const shortHash = stored.resolvedByCommitHash.slice(0, 10);
      try {
        await gitApi.createComment(
          { content: `✅ Resolved in commit \`${shortHash}\`.` },
          repoId,
          pullRequestId,
          link.threadId,
          projectName,
        );
      } catch {
        // Reply comment is best-effort; thread status was already updated
      }
    }
  }
}

export const comment = defineStep({
  id: "comment-review-results",
  description: "Reviews code changes and provides feedback",
  inputSchema: CommentInputSchema,
  outputSchema: CodeReviewResultSchema,
  execute: async ({ inputData, requestContext }) => {
    if (!inputData) {
      throw new Error("Input data not found");
    }

    const { prDetails, findings } = inputData;

    const agentConfig = extractAgentConfig(
      requestContext as unknown as CommonRequestContext,
    );

    const adoClient = agentConfig.getAdoClient();
    const rootConfig = await agentConfig.getRootConfig();
    const findingStore = new FindingStore(
      rootConfig.findingStorePath ?? ".ratan/data/findings.db",
    );
    await findingStore.init();

    const codeCommentIds: number[] = [];

    // Post inline comments from scanner pipeline findings
    const storedFindings = findingStore.getFindingsByPr(
      prDetails.pullRequestId,
      prDetails.repoName,
    );
    const linkedThreads = findingStore.getCommentThreadsByPr(
      prDetails.pullRequestId,
      prDetails.repoName,
    );
    const previouslyLinked = indexPreviouslyLinkedFindings(
      storedFindings,
      linkedThreads,
    );
    await closeResolvedInlineComments({
      adoClient,
      links: linkedThreads,
      pullRequestId: prDetails.pullRequestId,
      repoId: prDetails.repoId,
      storedFindings,
    });
    await refreshLinkedInlineComments({
      adoClient,
      findings,
      links: linkedThreads,
      projectName: adoClient.getProjectName(),
      pullRequestId: prDetails.pullRequestId,
      repoId: prDetails.repoId,
      storedFindings,
    });
    const findingsToComment = evaluatePostableFindings(
      findings,
      previouslyLinked,
    ).findings;
    for (const finding of findingsToComment) {
      let commentThread: { id?: number };
      try {
        commentThread = await adoClient.addCommentThreadForPRCode({
          repoId: prDetails.repoId,
          pullRequestId: prDetails.pullRequestId,
          comment: formatInlineFinding(finding),
          filePath: finding.filePath,
          filePosition: "right",
          fileStartLine: finding.lineStart,
          fileEndLine: finding.lineEnd ?? finding.lineStart,
          fileStartOffset: 1,
          fileEndOffset: 1,
        });
      } catch (error) {
        // Silently skip per-line comment failures
        continue;
      }

      if (commentThread.id === undefined) continue;
      codeCommentIds.push(commentThread.id);

      try {
        findingStore.linkCommentThread({
          repository: prDetails.repoName,
          prId: prDetails.pullRequestId,
          findingId: finding.id,
          threadId: commentThread.id,
        });
      } catch (error) {
        console.error(
          `[comment-review-results] Failed to link comment thread ${commentThread.id} to finding ${finding.id}: ${(error as Error).message}`,
        );
      }
    }
    findingStore.close();

    const mainCommentThread = await upsertReviewConclusion({
      adoClient,
      repoName: prDetails.repoName,
      pullRequestId: prDetails.pullRequestId,
      content: formatReviewConclusion({
        findings,
        latestSourceCommitId: prDetails.latestSourceCommitId,
        measures: inputData.measures,
        mergeDecision: inputData.mergeDecision,
        prDescription: rootConfig.report?.includePrDescription
          ? prDetails.description
          : undefined,
        changesSinceLastReview: inputData.changesSinceLastReview,
      }),
    });

    await adoClient.setPullRequestProperties(
      prDetails.repoName,
      prDetails.pullRequestId,
      {
        [`/${CODE_REVIEW_AGENT_LATEST_REVIEW_ID}`]: String(
          prDetails.latestSourceCommitId,
        ),
      },
    );

    return {
      mainCommentId: mainCommentThread.id,
      codeCommentIds,
    };
  },
});
