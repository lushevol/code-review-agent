import type { LineDiffBlockChangeType } from "azure-devops-node-api/interfaces/GitInterfaces.js";

export type ChangeJson = {
  newFilePath: string;
  oldFilePath: string;
  changeType: string;
  blocks: CodeChangeBlock[];
};

export type ChangeJsonWithDiff = ChangeJson & { changes: string };

export type CodeChangeBlock = {
  changeType: LineDiffBlockChangeType;
  oLine: number;
  oLinesCount: number;
  mLine: number;
  mLinesCount: number;
  oLines: string[]; // original lines
  mLines: string[]; // modified lines
  truncatedBefore?: boolean;
  truncatedAfter?: boolean;
};

// Pipeline Runs
