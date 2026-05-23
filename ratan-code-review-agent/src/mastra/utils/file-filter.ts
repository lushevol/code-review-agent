import { minimatch } from "minimatch";
import type { CodeChanges } from "../types";

export const filterReviewableFiles = <T extends CodeChanges>(
  fileChanges: T,
  filePathsAllowlist: string[],
  filePathsBlocklist: string[],
) => {
  return fileChanges.filter(({ newFilePath, changeType }) => {
    const isInAllowlist =
      filePathsAllowlist.length === 0 ||
      filePathsAllowlist.some((pattern) => minimatch(newFilePath, pattern));
    const isInBlocklist = filePathsBlocklist.some((pattern) =>
      minimatch(newFilePath, pattern),
    );
    const isDeleted = changeType.toLowerCase() === "delete";
    return isInAllowlist && !isInBlocklist && !isDeleted;
  });
};
