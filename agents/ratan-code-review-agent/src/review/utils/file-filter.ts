import { minimatch } from "minimatch";
export const filterReviewableFiles = <
  T extends Array<{ newFilePath: string; changeType: string }>,
>(
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
  }) as T;
};
