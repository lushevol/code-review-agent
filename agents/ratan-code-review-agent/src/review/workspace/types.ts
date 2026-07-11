import type { AdoPullRequestMetadata } from "ratan-ado-api";

export type ChangedFileStatus = "added" | "modified" | "deleted" | "renamed";

export interface AddedLine {
  line: number;
  text: string;
}

export interface ChangedFile {
  path: string;
  previousPath?: string;
  status: ChangedFileStatus;
  addedLines: AddedLine[];
}

export interface ReviewWorkspace {
  repoPath: string;
  mergeBaseCommit: string;
  headCommit: string;
  changes: ChangedFile[];
  runDirectory: string;
}

export interface ReviewWorkspaceProvider {
  withWorkspace<T>(
    metadata: AdoPullRequestMetadata,
    callback: (workspace: ReviewWorkspace) => Promise<T>,
  ): Promise<T>;
}
