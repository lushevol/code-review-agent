import { z } from "zod";

export const AzureDevOpsOptionsSchema = z.object({
  organization: z.string().optional(),
  project: z.string().optional(),
});

export type AzureDevOpsOptions = z.infer<typeof AzureDevOpsOptionsSchema>;

export const CodeDiffSchema = z.object({
  changes: z.string(),
  newFilePath: z.string(),
  oldFilePath: z.string(),
  changeType: z.string(),
});

export type CodeDiff = z.infer<typeof CodeDiffSchema>;

export const AdoPullRequestSchema = z.object({
  pullRequestId: z.number(),
  repoName: z.string(),
  repoId: z.string(),
  codeDiffs: z.string(),
  codeDiffsArray: z.array(CodeDiffSchema),
  commentThreads: z.array(z.any()).optional(),
  latestIterationId: z.number(),
  title: z.string().optional(),
  description: z.string().optional(),
  createdBy: z.string().optional(),
  status: z.string().optional(),
});

export type AdoPullRequest = z.infer<typeof AdoPullRequestSchema>;

export const PullRequestListItemSchema = z.object({
  pullRequestId: z.number().optional(),
  repository: z
    .object({
      name: z.string().optional(),
    })
    .optional(),
  title: z.string().optional(),
  status: z.string().optional(),
  creationDate: z.string().optional(),
  sourceRefName: z.string().optional(),
  targetRefName: z.string().optional(),
});

export type PullRequestListItem = z.infer<typeof PullRequestListItemSchema>;

export const RepositorySchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  url: z.string().optional(),
});

export type Repository = z.infer<typeof RepositorySchema>;

export const PullRequestIterationSchema = z.object({
  id: z.number(),
  sourceRefName: z.string().optional(),
  targetRefName: z.string().optional(),
});

export type PullRequestIteration = z.infer<typeof PullRequestIterationSchema>;

export const IterationChangeFileSchema = z.object({
  newFilePath: z.string(),
  oldFilePath: z.string(),
  changeType: z.string().optional(),
});

export type IterationChangeFile = z.infer<typeof IterationChangeFileSchema>;

export const AddCommentThreadParamsSchema = z.object({
  repoId: z.string(),
  pullRequestId: z.number(),
  comment: z.string(),
  filePath: z.string(),
  filePosition: z.string().optional(),
  fileStartLine: z.number().optional(),
  fileEndLine: z.number().optional(),
  fileStartOffset: z.number().optional(),
  fileEndOffset: z.number().optional(),
});

export type AddCommentThreadParams = z.infer<
  typeof AddCommentThreadParamsSchema
>;
