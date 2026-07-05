import { Injectable, Logger } from "@nestjs/common";
// biome-ignore lint/style/useImportType: <explanation>
// import { ConfigService } from "@nestjs/config";
import { AzureDevOps, type StoryWorkItemType } from "ratan-ado-api";
import { jsonToMarkdown, table } from "ratan-markdown-tool";
import { SonarQubeClient } from "ratan-sonarqube-api";
// biome-ignore lint/style/useImportType: <explanation>
import { DrizzleService } from "src/drizzle/drizzle.service";
// biome-ignore lint/style/useImportType: <explanation>
import { OctAuthService } from "./auth.service";
// biome-ignore lint/style/useImportType: <explanation>
import { IssueClassificationService } from "./issues-classify.service";
import { openai } from "./openai-client";
// biome-ignore lint/style/useImportType: <explanation>
import type { CodeReviewIssue } from "./types";
import { codeCommentHelper } from "./utils/code-comment";
import { applyConfidenceScoreFilter } from "./utils/confidence-score-filter";
import { getSimilarity } from "./utils/duplicate-issue-check";
import { shouldReviewFile } from "./utils/file-filter";
import { extractFileExtension } from "./utils/file-utils";
import { maskSensitiveData } from "./utils/sensitive-data-mask";
import { sortIssues } from "./utils/sort-issues";
import {
  languageSpecificPrompt,
  projectSpecificPrompt,
  repoSpecificPrompt,
} from "./utils/specific-prompt";

const MAX_TOKEN = 20000;
const MAX_CHARACTER = MAX_TOKEN * 4; // 4MB
const CODE_REVIEW_AGENT_LATEST_REVIEW_ID = "CODE_REVIEW_AGENT_LATEST_REVIEW_ID";
const CONFIDENCE_SCORE_THRESHOLD = 0.8;

@Injectable()
export class CodeReviewOrchestrationService {
  constructor(
    private readonly drizzleService: DrizzleService,
    private readonly octAuthService: OctAuthService,
    private readonly issueClassificationService: IssueClassificationService,
  ) {}

  private readonly logger = new Logger(CodeReviewOrchestrationService.name, {
    timestamp: true,
  });

  async processCodeReview(prId: number) {
    this.logger.log(`Starting code review process for PR ${prId}`);
    const { adoToken, sonarToken } =
      await this.octAuthService.getAvailableAuth();

    const adoClient = new AzureDevOps();
    await adoClient.connect(adoToken);
    const {
      repoName,
      repoId,
      pullRequestId,
      latestSourceCommitId,
      latestTargetCommitId,
      title,
      description,
      sourceBranch,
      targetBranch,
      creationDate,
      authorId,
      latestIterationId,
      codeDiffs,
      codeDiffsArray,
    } = await adoClient.getPullRequestById(prId, false, false, true);
    const codeDiffsWithRedacted = maskSensitiveData(codeDiffs);
    let codeChangesArray = codeDiffsArray?.map((i) => ({
      ...i,
      changes: maskSensitiveData(i.changes),
    }));

    const prProperties = await adoClient.getPullRequestProperties(
      repoName,
      prId,
    );
    const latestReviewId =
      prProperties.value[CODE_REVIEW_AGENT_LATEST_REVIEW_ID]?.$value;
    this.logger.log(
      `Latest review iteration ID for PR ${prId} is ${latestReviewId}`,
    );

    if (
      latestReviewId !== undefined &&
      Number(latestReviewId) !== latestIterationId
    ) {
      // new commit is pushed
      this.logger.log(
        `New commit detected for PR ${prId}, proceeding with review.`,
      );
      // get changed files
      const changedFiles = await adoClient.getPullRequestIterationChangesFiles({
        repoId,
        prId,
        iterationId: latestIterationId,
        compareToIterationId: latestReviewId ? Number(latestReviewId) : 0,
      });
      this.logger.log(
        `Changed files for PR ${prId} between iterations ${latestReviewId} and ${latestIterationId}: ${changedFiles.map(
          (f) => f.newFilePath,
        )}`,
      );
      // filter codeChangesArray to only include changed files
      codeChangesArray = codeChangesArray.filter((i) =>
        changedFiles.some(
          (f) =>
            f.newFilePath === i.newFilePath && f.oldFilePath === i.oldFilePath,
        ),
      );
    }

    const prDescription = await this.prDescribeBot(
      codeDiffsWithRedacted,
      title,
      description,
    );
    this.logger.log(`Complete generate pr description for PR ${prId}`);
    const reviewResult: {
      approve: boolean;
      errors: Array<CodeReviewIssue>;
    } = { approve: true, errors: [] };
    for (const codeDiff of codeChangesArray) {
      const { pass: newPass, notPassReason: newNotPassReason } =
        shouldReviewFile(codeDiff.newFilePath || "");
      const { pass: oldPass, notPassReason: oldNotPassReason } =
        shouldReviewFile(codeDiff.oldFilePath || "");
      if (!newPass && !oldPass) {
        if (!newPass) {
          this.logger.log(
            `Skipping review for file ${codeDiff.newFilePath} in PR ${prId}, reason: ${newNotPassReason}`,
          );
        } else if (!oldPass) {
          this.logger.log(
            `Skipping review for file ${codeDiff.oldFilePath} in PR ${prId}, reason: ${oldNotPassReason}`,
          );
        }
        continue;
      }

      // skip deleted files
      if (codeDiff.changeType === "Delete") {
        this.logger.log(
          `Skipping review for deleted file ${codeDiff.oldFilePath} in PR ${prId}`,
        );
        continue;
      }
      this.logger.log(
        `Reviewing file ${codeDiff.newFilePath || codeDiff.oldFilePath} in PR ${prId}`,
      );
      try {
        const changes = codeDiff.changes;
        const chunks: string[] = [];
        if (changes.length > MAX_CHARACTER) {
          // Split changes into chunks of MAX_TOKEN size
          for (let i = 0; i < changes.length; i += MAX_CHARACTER) {
            const chunk = changes.slice(i, i + MAX_CHARACTER);
            chunks.push(chunk);
          }
        } else {
          chunks.push(changes);
        }
        for (const chunk of chunks) {
          const result = await this.prrBot(
            chunk,
            repoName,
            codeDiff.newFilePath,
          );
          result.errors.forEach(
            (i) =>
              (i.file = codeDiff.newFilePath || codeDiff.oldFilePath || i.file),
          );
          reviewResult.errors.push(
            ...applyConfidenceScoreFilter(
              result.errors,
              CONFIDENCE_SCORE_THRESHOLD,
            ),
          );
          if (result.errors.length > 0) reviewResult.approve = false;
        }
      } catch (error) {
        this.logger.error(
          `Error reviewing file ${codeDiff.newFilePath || codeDiff.oldFilePath} in PR ${prId}:`,
          error,
        );
      }
    }

    // rerank
    this.logger.log(`Reranking issues for PR ${prId}`);
    const rerankedErrors = await this.rerankResults(reviewResult);
    reviewResult.errors = applyConfidenceScoreFilter(
      rerankedErrors.errors,
      CONFIDENCE_SCORE_THRESHOLD,
    );

    // filter duplicate issues
    this.logger.log(`Filtering duplicate issues for PR ${prId}`);
    reviewResult.errors = await this.filterDuplicateIssues(
      reviewResult.errors,
      prId,
      latestSourceCommitId,
      latestTargetCommitId,
    );

    // Sort errors by severity and priority
    reviewResult.errors = sortIssues(reviewResult.errors);

    if (reviewResult.errors.length === 0) {
      this.logger.log(
        `No issues found in PR ${prId}, skipping classification.`,
      );
    } else {
      this.logger.log(
        `Found ${reviewResult.errors.length} issues in PR ${prId}, classifying...`,
      );
      try {
        const classifiedErrors =
          await this.issueClassificationService.classifyIssues(
            reviewResult.errors,
          );
        reviewResult.errors = reviewResult.errors.map((err, index) => {
          return {
            ...err,
            category: classifiedErrors[index]?.category || "",
            sub_category: classifiedErrors[index]?.sub_category || "",
          };
        });
        this.logger.log(
          `Completed issue classification for PR ${prId}, total issues: ${reviewResult.errors.length}`,
        );
      } catch (error) {
        this.logger.error("Error classifying issues:", error);
      }
    }

    const relatedWorkitems = [];
    // for (const workItemId of workItemIds.slice(0, 5)) {
    //   const workItem = await adoClient.getCommonWorkItems([workItemId]);
    //   const wi = await this.wiSummaryBot(workItem.at(0));
    //   wi.summary && relatedWorkitems.push(wi);
    // }

    // this.logger.log(`Completed fetching related work items for PR ${prId}.`);

    let measures = null;
    try {
      const sonarClient = new SonarQubeClient();
      await sonarClient.connect(sonarToken);
      measures = await sonarClient.getMeasures(prId, repoName);
      this.logger.log(
        `Completed fetching sonar measures for PR ${prId}.`,
        measures,
      );
    } catch (error) {
      this.logger.error("Error fetching measures:", error.message);
    }

    const codeCommentIds: number[] = [];
    // TODO: limit to 30 comments for now
    const revertedErrors = [...reviewResult.errors].slice(0, 30).reverse();
    for (const err of revertedErrors) {
      try {
        const commentThread = await adoClient.addCommentThreadForPRCode({
          repoId,
          pullRequestId,
          comment: codeCommentHelper({
            issue: err.message,
            severity: err.severity,
            priority: err.priority,
            suggestion: err.suggestion,
            suggestionCode: err.suggestion_code,
            survey: true,
          }),
          filePath: err.file,
          filePosition: "right",
          fileStartLine: err.line,
          fileEndLine: err.line,
          fileStartOffset: 1,
          fileEndOffset: 1,
        });

        codeCommentIds.push(commentThread.id);
        this.logger.log(`Completed adding code comment to PR ${prId}.`);
      } catch (error) {
        this.logger.error(`Error adding code comment:`, error);
      }
    }

    const mainCommentThread = await adoClient.addCommentForPR(
      repoName,
      pullRequestId,
      reviewResult,
      prDescription,
      relatedWorkitems,
      measures,
    );

    this.logger.log(`Completed adding main comment to PR ${prId}.`);

    await adoClient.setPullRequestProperties(repoName, prId, {
      [`/${CODE_REVIEW_AGENT_LATEST_REVIEW_ID}`]: String(latestIterationId),
    });

    let mainCommentRecordId = 0;
    try {
      const [record] = await this.drizzleService.upsertPullRequestReview({
        repo: repoName,
        prId: pullRequestId,
        sourceBranch,
        targetBranch,
        latestSourceCommit: latestSourceCommitId,
        latestTargetCommit: latestTargetCommitId,
        status: "Done",
        title: title,
        description: prDescription,
        codeChanges: codeChangesArray
          .map(
            (i) =>
              `${i.changeType}\n--${i.oldFilePath}\n++${i.newFilePath}\n${i.changes?.slice(0, MAX_TOKEN) ?? ""}`,
          )
          .join("\n"),
        raisedBy: authorId,
        sonarResult: JSON.stringify(measures),
        codeReviewPassed: reviewResult.approve,
        commentThreadId: mainCommentThread?.id,
        prCreatedAt: creationDate,
      });
      mainCommentRecordId = record.id;
      this.logger.log(`Upserted pull request review for PR ${prId}.`);
    } catch (error) {
      this.logger.error("Error upserting pull request review:", error);
    }

    try {
      let errorIndex = 0;
      for (const err of revertedErrors) {
        const {
          file,
          suggestion_code,
          confidence_score,
          category,
          sub_category,
          ...rest
        } = err;
        await this.drizzleService.batchCreateCodeReviewIssues([
          {
            ...rest,
            filePath: file,
            prReviewId: mainCommentRecordId,
            commentThreadId: codeCommentIds[errorIndex] || 0,
            suggestionCode: suggestion_code,
            checklistNo: errorIndex,
            confidenceScore: confidence_score,
            issueCategory: category,
            issueSubCategory: sub_category,
          },
        ]);
        errorIndex++;
      }
      this.logger.log(`Upserted code review issues for PR ${prId}.`);
    } catch (error) {
      this.logger.error("Error upserting code review issues:", error);
    }
    this.logger.log(`Completed code review process for PR ${prId}`);
  }

  async prDescribeBot(codeDiffs: string, title: string, description: string) {
    let warning = "";
    if (codeDiffs.length > MAX_CHARACTER) {
      codeDiffs = codeDiffs.slice(0, MAX_CHARACTER);
      warning =
        "[Warning: The code diff is too large, only the first part is included.]\n";
    }
    if (codeDiffs.trim() === "") {
      return "No code changes detected.";
    }

    const response = await openai.chat("gpt-5-mini").doGenerate({
      prompt: [
        {
          role: "system",
          content: `You are an expert software developer and architect.
            You are an expert at writing English technical documentation.

            ## Task

            - Describe a high level summary of the changes in <GIT_DIFF> for a pull request in a way that a software engineer will understand.

            ## Instructions

            - do NOT explain that <GIT_DIFF> displays changes in the codebase
            - try to extract the intent of the changes, don't focus on the details
            - use bullet points to list the changes
            - use emojis to make the description more engaging
            - focus on the most important changes
            - ignore comments about imports (like added, remove, changed, etc.)
            - ONLY output the summary, no pr title and pr description.
            
            PR Title: ${title}

            PR Description: ${description}

            <GIT_DIFF>
              ${codeDiffs}
            </GIT_DIFF>
          `,
        },
      ],
      temperature: 0.2,
      maxOutputTokens: MAX_TOKEN,
    });

    const content = response.content
      .flatMap((i) => (i.type === "text" ? i.text : ""))
      .join("");

    return warning + content;
  }

  async prrBot(
    changes: string,
    repoName: string,
    filePath: string,
  ): Promise<{
    errors: Array<CodeReviewIssue>;
  }> {
    if (changes.length === 0) {
      return { errors: [] };
    }

    const extension = extractFileExtension(filePath);

    const response = await openai.chat("gpt-5-mini").doGenerate({
      prompt: [
        {
          role: "system",
          content: `You are an expert software developer and architect. You are an expert in software reliability, security, scalability, and performance.

            ## Task

            Review the changes in <CODE_CHANGES> which contains the diff of the last commit in the pull request branch.
            Provide feedback using the defined json schema.

            ## Guidelines

            - Assume all code changes are intentional and align with updated business requirements as provided by the developer.
            - Do NOT question the purpose of logic changes if they are clearly due to business requirements.
            - Focus on identifying risks introduced by the changes, such as regressions, security vulnerabilities, or performance issues.
            - Only raise concerns if the new logic introduces clear errors, risks, or unintended side effects.
            - Do NOT flag changes solely because the logic is different from before; only report if you are certain there is a problem.
            - Trust the developer's intent for the change, but remain vigilant for any issues that could impact reliability, security, or correctness.
            - Assume the code is type correct, the compiler found all the syntax errors.
            - IMPORTANT: You don't have to report the issue if you require "ensure" or "confirm" or "verify" from the developer. ONLY report if you are 100% sure.
            - Reduce the severity of issues if the new code follows the same pattern as the existing code, even if the pattern is not ideal.
            - Report logical errors or omissions.
            - Report correctness of string content (such as extra spaces, spelling mistakes, inconsistent formatting) issues.
            - Report performance issues (such as n+1 query, inefficient algorithms, etc.) only if you are sure.
            - Only report issues you are absolutely certain about; do NOT report if you don't know the context or background.
            - DO NOT report issues in comments and commented-out code.
            - Do NOT report issues that the type checker would find.
            - Do NOT report deleted code since you cannot review the entire codebase.
            - Do NOT report deleted or missing imports, as you may not know the full file.
            - Do NOT report missing class or variable definitions, as you may not know the full file.
            - Do NOT report type issues of class or variable definitions, as you may not know the full file.
            - Do NOT report issues for the following codes: missing_coma, missing_comment, missing_blank_line, missing_dependency, missing_error_handling.
            - Do NOT report issues only on readability or code style. e.g. new lines, spaces, indentation, variable naming, function naming, class naming, file naming, file structure, code structure, comments, comment style, comment format, comment content, comment spelling.
            - Do NOT report missing types.
            - Do NOT report warnings, only errors.
            - Use best practices of the programming language of each file.
            - Analyze ALL the code. Do not be lazy. This is IMPORTANT.
            - Add suggestions and suggestion code if possible; skip if you are not sure about a fix.
            - Report at most 2 serious errors only; ignore warnings.

            ${projectSpecificPrompt()}

            ## Response Format

            - You MUST respond in JSON format that adheres to the following schema:
            \`\`\`json
            // an array of error objects, empty if no errors found, max length is 2
            {
              errors: [
                {
                  file: string; // the file path of the error
                  line: integer; // the line number of the error
                  severity: "Critical" | "High" | "Medium" | "Low"; // severity level, only one of these values
                  priority: "P1" | "P2" | "P3" | "P4" | "P5"; // priority level, only one of these values. P1 is highest, P5 is lowest.
                  message: string; // a description of the error
                  suggestion: string; // a suggestion to fix the error, if available
                  suggestion_code: string; // a code snippet that illustrates the suggestion, if available
                  confidence_score: number; // a float number between 0 and 1 indicating the confidence level of the error detection
                }
              ]
            }
            \`\`\`
            - Ensure that your response is valid JSON. Do NOT include any explanations or additional text outside of the JSON structure.
            - If you find no issues, respond with empty array.
          
            ${repoSpecificPrompt(repoName)}

            ${languageSpecificPrompt(extension)}

            ## Code Changes

            <CODE_CHANGES>
            ${changes}
            </CODE_CHANGES>
        `,
        },
      ],
      temperature: 0.2,
      maxOutputTokens: MAX_TOKEN,
      responseFormat: {
        type: "json",
        schema: {
          type: "object",
          properties: {
            errors: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  file: { type: "string" },
                  line: { type: "integer" },
                  severity: {
                    type: "string",
                    enum: ["Critical", "High", "Medium", "Low"],
                  },
                  priority: {
                    type: "string",
                    enum: ["P1", "P2", "P3", "P4", "P5"],
                  },
                  message: { type: "string" },
                  suggestion: { type: "string" },
                  suggestion_code: { type: "string" },
                  confidence_score: { type: "number", minimum: 0, maximum: 1 },
                },
                required: [
                  "file",
                  "line",
                  "severity",
                  "priority",
                  "message",
                  "suggestion",
                  "suggestion_code",
                  "confidence_score",
                ],
              },
            },
          },
        },
      },
    });

    const content = response.content
      .flatMap((i) => (i.type === "text" ? i.text : ""))
      .join("");

    try {
      const errors = JSON.parse(content || "");
      if (!Array.isArray(errors)) {
        if (Array.isArray(errors.errors)) {
          return { errors: errors.errors };
        }
        this.logger.error(
          "prrBot response not valid:",
          JSON.stringify(content),
        );
        return {
          errors: [],
        };
      }
      return {
        errors,
      };
    } catch (error) {
      this.logger.error("Error parsing prrBot response:", response?.content);
      return {
        errors: [],
      };
    }
  }

  async rerankResults({ errors }: { errors: Array<CodeReviewIssue> }): Promise<{
    errors: Array<CodeReviewIssue>;
  }> {
    if (errors.length === 0) {
      return { errors };
    }

    const response = await openai.chat("gpt-5-mini").doGenerate({
      prompt: [
        {
          role: "system",
          content: `You got a list of issues from prior analysis. Rerank issues on their confidence_score base on principles below. Issues are in <ISSUES> tag.

            If issues not follows the principles, reduce the confidence_score.

            ## Principles

            - Assume all code changes are intentional and align with updated business requirements as provided by the developer.
            - Do NOT question the purpose of logic changes if they are clearly due to business requirements.
            - Focus on identifying risks introduced by the changes, such as regressions, security vulnerabilities, or performance issues.
            - Only raise concerns if the new logic introduces clear errors, risks, or unintended side effects.
            - Do NOT flag changes solely because the logic is different from before; only report if you are certain there is a problem.
            - Trust the developer's intent for the change, but remain vigilant for any issues that could impact reliability, security, or correctness.
            - Assume the code is type correct, the compiler found all the syntax errors.
            - IMPORTANT: You don't have to report the issue if you require "ensure" or "confirm" or "verify" from the developer. ONLY report if you are 100% sure.
            - Reduce the severity of issues if the new code follows the same pattern as the existing code, even if the pattern is not ideal.
            - Report logical errors or omissions.
            - Report correctness of string content (such as extra spaces, spelling mistakes, inconsistent formatting) issues.
            - Report performance issues (such as n+1 query, inefficient algorithms, etc.) only if you are sure.
            - Only report issues you are absolutely certain about; do NOT report if you don't know the context or background.
            - DO NOT report issues in comments and commented-out code.
            - Do NOT report issues that the type checker would find.
            - Do NOT report deleted code since you cannot review the entire codebase.
            - Do NOT report deleted or missing imports, as you may not know the full file.
            - Do NOT report missing class or variable definitions, as you may not know the full file.
            - Do NOT report type issues of class or variable definitions, as you may not know the full file.
            - Do NOT report issues for the following codes: missing_coma, missing_comment, missing_blank_line, missing_dependency, missing_error_handling.
            - Do NOT report issues only on readability or code style. e.g. new lines, spaces, indentation, variable naming, function naming, class naming, file naming, file structure, code structure, comments, comment style, comment format, comment content, comment spelling.
            - Do NOT report missing types.
            - Do NOT report warnings, only errors.

            ## Response Format

            - You MUST respond in JSON format that adheres to the following schema:
            \`\`\`json
            // an array of error objects, empty if no errors found, max length is 2
            {
              list: [
                {
                  index: number; // the index of error
                  confidence_score: number; // a float number between 0 and 1 indicating the confidence level of the error detection
                }
              ]
            }
            \`\`\`
            - Ensure that your response is valid JSON. Do NOT include any explanations or additional text outside of the JSON structure.
          
            ## Code Review Issues

            <ISSUES>
            ${jsonToMarkdown([
              table(
                ["Index", "Message", "Suggestion"],
                errors.map((err, index) => [
                  `${index}`,
                  err.message?.replace(/\|/g, "\\|") ?? "",
                  err.suggestion?.replace(/\|/g, "\\|") ?? "",
                ]),
              ),
            ])}
            </ISSUES>
        `,
        },
      ],
      temperature: 0.2,
      maxOutputTokens: MAX_TOKEN,
      responseFormat: {
        type: "json",
        schema: {
          type: "object",
          properties: {
            list: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "integer" },
                  confidence_score: { type: "number", minimum: 0, maximum: 1 },
                },
                required: ["index", "confidence_score"],
              },
            },
          },
        },
      },
    });

    const content = response.content
      .flatMap((i) => (i.type === "text" ? i.text : ""))
      .join("");

    try {
      const rerankResults: {
        list: Array<{
          index: number;
          confidence_score: number;
        }>;
      } = JSON.parse(content || "");
      return {
        errors: errors.map((e, idx) => {
          const rerankResult = rerankResults.list.find((r) => r.index === idx);
          return {
            ...e,
            confidence_score:
              rerankResult?.confidence_score ?? e.confidence_score,
          };
        }),
      };
    } catch (error) {
      this.logger.error(
        "Error parsing rerank agent response:",
        response?.content,
      );
      return {
        errors,
      };
    }
  }

  async wiSummaryBot(workItem: StoryWorkItemType) {
    const { title, type, description, acceptanceCriteria, comments } = workItem;

    const response = await openai.chat("gpt-5-mini").doGenerate({
      prompt: [
        {
          role: "system",
          content: `You are a work item summary generator. Generate a concise summary for the following work item:
            Title: ${title}
            Description: ${description}
            Acceptance Criteria: ${acceptanceCriteria}
            Comments: ${comments}
            
            Please ensure the summary is clear and concise. Start with "this ${String.prototype.toLowerCase.call(type)} intends to"`,
        },
      ],
      temperature: 0.2,
      maxOutputTokens: MAX_TOKEN,
    });

    const content = response.content
      .flatMap((i) => (i.type === "text" ? i.text : ""))
      .join("");

    return {
      ...workItem,
      summary: content,
    };
  }

  async filterDuplicateIssues(
    issues: CodeReviewIssue[],
    prId: number,
    latestSourceCommitId: string,
    latestTargetCommitId: string,
  ): Promise<CodeReviewIssue[]> {
    if (issues.length === 0) {
      return issues;
    }
    const prs = await this.drizzleService.searchPullRequestReviewMemory({
      prId,
      latestSourceCommit: latestSourceCommitId,
      latestTargetCommit: latestTargetCommitId,
      pageNo: 0,
      pageSize: 10,
    });
    const pr = prs.data.at(0);

    if (!pr) {
      return issues;
    }

    const existingIssues = await this.drizzleService.listCodeReviewIssues({
      prReviewIdList: [pr.id],
      pageNo: 0,
      pageSize: 1000,
    });

    this.logger.log(
      `Found ${existingIssues.total} existing issues for PR ${prId}, filtering duplicates...`,
    );

    if (existingIssues.total === 0) {
      return issues;
    }

    const filteredIssues = issues.filter((i) => {
      const existingIssuesWithSameFileAndLine = existingIssues.data.filter(
        (ei) => ei.filePath === i.file && Math.abs(ei.line - i.line) < 10,
      );
      const res = !existingIssuesWithSameFileAndLine.some(
        (ei) =>
          ei.message === i.message ||
          getSimilarity(ei.message, i.message) > 0.8,
      );

      if (res) {
        this.logger.log(
          `Issue "${i.message}" in file ${i.file} at line ${i.line} is a duplicate.`,
        );
      }
      return res;
    });

    return filteredIssues;
  }
}
