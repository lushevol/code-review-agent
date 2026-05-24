import type * as GitApi from "azure-devops-node-api/GitApi.js";
import {
  CommentThreadStatus,
  CommentType,
  type GitPullRequestCommentThread,
} from "azure-devops-node-api/interfaces/GitInterfaces.js";
import {
  type DataObject,
  h3,
  h4,
  jsonToMarkdown,
  line,
  list,
  p,
} from "ratan-markdown-tool";
import type { AdoWebApi, ReviewResultJson } from "./interfaces.ts";
// import type { ParsedMeasuresComponent } from "../sonarqube/interfaces.ts";
import { botWrap } from "./utils.ts";

type ParsedMeasuresComponent = null | {
  coverage: number;
  reliability_rating: number;
  duplicated_lines_density: number;
  code_smells: number;
  duplicated_lines: number;
  new_vulnerabilities: number;
  new_coverage: number;
  new_uncovered_conditions: number;
  new_branch_coverage: number;
  new_bugs: number;
  new_code_smells: number;
  new_line_coverage: number;
  bugs: number;
  lines_to_cover: number;
  uncovered_conditions: number;
  uncovered_lines: number;
  branch_coverage: number;
  vulnerabilities: number;
  new_uncovered_lines: number;
  line_coverage: number;
  conditions_to_cover: number;
  new_lines_to_cover: number;
};

const reviewCommentGenerator = (
  repoName: string,
  pullRequestId: number,
  conclusion: string,
  reviewResult: ReviewResultJson,
  prDescription: string,
  relatedWorkitems: { summary: string; title: string }[],
  sonarResult?: ParsedMeasuresComponent,
): string => {
  const { errors = [] } = reviewResult ?? {};
  const commentResults: DataObject[] = [];
  commentResults.push(p(conclusion));
  commentResults.push(line());
  commentResults.push(h3("PR Description:"));
  commentResults.push(p(prDescription));
  if (relatedWorkitems.length > 0) {
    commentResults.push(line());
    commentResults.push(h3("Related Work Items:"));
    relatedWorkitems.forEach((wi) => {
      commentResults.push(h4(`${wi.title}`));
      commentResults.push(p(`${wi.summary}`));
    });
  }
  commentResults.push(line());
  commentResults.push(h3("Code Review Results:"));
  commentResults.push(
    p(
      errors.length === 0
        ? "✅ New commits in pull request has no error detected."
        : "❌ New commits in pull request has errors in following comments.",
    ),
  );

  // if (errors.length > 0) {
  //   commentResults.push(
  //     table(
  //       [
  //         "No",
  //         "File",
  //         "Message",
  //         "Suggestion",
  //         // "Suggestion Code",
  //         "Severity",
  //         "Priority",
  //       ],
  //       errors.map((err, index) => [
  //         `${index + 1}`,
  //         `${err.file}:${err.line}`,
  //         err.message?.replace(/\|/g, "\\|") ?? "",
  //         err.suggestion?.replace(/\|/g, "\\|") ?? "",
  //         // err.suggestion_code ? `\`\`\`\n${err.suggestion_code.replace(/\|/g, "\\|").replace(/\n/g, "<br>")}\n\`\`\`` : "",
  //         err.severity ?? "",
  //         err.priority ?? "",
  //       ]),
  //     ),
  //   );
  // }

  commentResults.push(line());
  commentResults.push(h3("SonarQube Analysis Results:"));
  if (sonarResult) {
    commentResults.push(
      list([
        `**Coverage**: ${sonarResult.coverage ?? "N/A"}%`,
        `**Line Coverage**: ${sonarResult.line_coverage ?? "N/A"}%`,
        `**Branch Coverage**: ${sonarResult.branch_coverage ?? "N/A"}%`,
        `**New Code Coverage**: ${sonarMeasuresLinkGenerator(repoName, pullRequestId, "new_coverage", sonarResult)}`,
        `**New Lines Coverage**: ${sonarMeasuresLinkGenerator(repoName, pullRequestId, "new_line_coverage", sonarResult)}`,
        `**New Branch Coverage**: ${sonarMeasuresLinkGenerator(repoName, pullRequestId, "new_branch_coverage", sonarResult)}`,
        `**New Vulnerabilities**: ${sonarMeasuresLinkGenerator(repoName, pullRequestId, "new_vulnerabilities", sonarResult)}`,
        `**New Bugs**: ${sonarMeasuresLinkGenerator(repoName, pullRequestId, "new_bugs", sonarResult)}`,
        `**New Code Smells**: ${sonarMeasuresLinkGenerator(repoName, pullRequestId, "new_code_smells", sonarResult)}`,
      ]),
    );
  } else {
    commentResults.push(p("No results available."));
  }

  return jsonToMarkdown(commentResults);
};

const sonarMeasuresLinkGenerator = (
  repo: string,
  prId: number,
  measureKey: string,
  sonarResult: ParsedMeasuresComponent,
) => {
  const unit = measureKey.includes("coverage") ? "%" : "";
  return `[${sonarResult[measureKey] ? sonarResult[measureKey] + unit : "N/A"}](https://sonarqube.vx.standardchartered.com/component_measures?metric=${measureKey}&pullRequest=${prId}&id=${repo})`;
};

const conslusionGenerator = (
  reviewResult: ReviewResultJson,
  sonarResult?: ParsedMeasuresComponent,
): [string, boolean] => {
  let approve = false;
  const { errors = [] } = reviewResult ?? {};
  const conclusionResults: DataObject[] = [];
  const hasReviewError = errors.length > 0;
  const sonarCoverageLT80 = sonarResult?.coverage < 80;
  const sonarBranchCoverageLT80 = sonarResult?.branch_coverage < 80;
  const sonarHasBugs = sonarResult?.new_bugs > 0;
  const sonarHasCodeSmells = sonarResult?.new_code_smells > 0;
  if (
    hasReviewError ||
    sonarCoverageLT80 ||
    sonarBranchCoverageLT80 ||
    sonarHasBugs ||
    sonarHasCodeSmells
  ) {
    conclusionResults.push(h3("Conclusion: Need Work"));
    const issueList = [];
    if (sonarCoverageLT80) {
      issueList.push(
        "SonarQube coverage is below 80%, which is not acceptable.",
      );
    }
    if (sonarBranchCoverageLT80) {
      issueList.push(
        "SonarQube branch coverage is below 80%, which is not acceptable.",
      );
    }
    if (sonarHasBugs) {
      issueList.push("SonarQube has detected new bugs that need to be fixed.");
    }
    if (sonarHasCodeSmells) {
      issueList.push(
        "SonarQube has detected new code smells that need to be fixed.",
      );
    }
    if (hasReviewError) {
      issueList.push(
        "New commits have introduced errors that need to be addressed.",
      );
    }

    conclusionResults.push(list(issueList));
  } else {
    approve = true;
    conclusionResults.push(h3("Conclusion: ✅ Approve for New Commits"));
  }

  return [jsonToMarkdown(conclusionResults), approve];
};

export async function addCommentForPR(
  repoName: string,
  pullRequestId: number,
  reviewResult: ReviewResultJson,
  prDescription: string,
  relatedWorkitems: { summary: string; title: string }[],
  sonarResult: ParsedMeasuresComponent,
) {
  const webApi = this.adoWebApi as AdoWebApi;
  const gitApi: GitApi.IGitApi = await webApi.getGitApi();
  const projectName = this.getProjectName();

  const [conslusion, isApprove] = conslusionGenerator(
    reviewResult,
    sonarResult,
  );

  const content = botWrap(
    reviewCommentGenerator(
      repoName,
      pullRequestId,
      conslusion,
      reviewResult,
      prDescription,
      relatedWorkitems,
      sonarResult,
    ),
  );

  const res = await gitApi.createThread(
    {
      comments: [
        {
          content,
        },
      ],
      // status: isApprove
      //   ? CommentThreadStatus.Closed
      //   : CommentThreadStatus.Active,
      status: CommentThreadStatus.Closed,
    },
    repoName,
    pullRequestId,
    projectName,
  );

  return res;
}

export async function addCommentThreadForPRCode({
  repoId,
  pullRequestId,
  comment,
  filePath,
  filePosition = "right",
  fileStartLine,
  fileEndLine,
  fileStartOffset,
  fileEndOffset,
  status = CommentThreadStatus.Active,
}: {
  repoId: string;
  pullRequestId: number;
  comment: string;
  filePath: string;
  filePosition: "left" | "right"; // left present before change, right present after change
  fileStartLine: number;
  fileEndLine: number;
  fileStartOffset: number;
  fileEndOffset: number;
  status?: CommentThreadStatus;
}): Promise<GitPullRequestCommentThread> {
  const webApi = this.adoWebApi as AdoWebApi;
  const gitApi = await webApi.getGitApi();
  const projectName = this.getProjectName();
  const thread = await gitApi.createThread(
    {
      comments: [
        {
          commentType: CommentType.Text,
          content: comment,
        },
      ],
      status,
      threadContext: {
        filePath,
        ...(filePosition === "right"
          ? {
              rightFileStart: {
                line: fileStartLine,
                offset: fileStartOffset,
              },
              rightFileEnd: {
                line: fileEndLine,
                offset: fileEndOffset,
              },
            }
          : {
              leftFileStart: {
                line: fileStartLine,
                offset: fileStartOffset,
              },
              leftFileEnd: {
                line: fileEndLine,
                offset: fileEndOffset,
              },
            }),
      },
    },
    repoId,
    pullRequestId,
    projectName,
  );

  console.log(`Comment added to PR ${pullRequestId} in repository ${repoId}.`);

  return thread;
}

export async function updateCommentThreadStatus(
  repoId: string,
  pullRequestId: number,
  threadId: number,
  status: CommentThreadStatus,
): Promise<GitPullRequestCommentThread> {
  const webApi = this.adoWebApi as AdoWebApi;
  const gitApi = await webApi.getGitApi();
  const projectName = this.getProjectName();
  const thread = await gitApi.updateThread(
    {
      status,
    },
    repoId,
    pullRequestId,
    threadId,
    projectName,
  );

  console.log(
    `Comment thread ${threadId} updated to status ${CommentThreadStatus[status]} in PR ${pullRequestId} in repository ${repoId}.`,
  );

  return thread;
}

export async function getCommentThreadById(
  repoId: string,
  prId: number,
  commentThreadId: number,
) {
  const webApi = this.adoWebApi as AdoWebApi;
  const gitApi = await webApi.getGitApi();
  const projectName = this.getProjectName();
  const thread = await gitApi.getPullRequestThread(
    repoId,
    prId,
    commentThreadId,
    projectName,
  );

  console.log(
    `Fetched comment thread ${commentThreadId} in project ${projectName}.`,
  );

  return thread;
}
