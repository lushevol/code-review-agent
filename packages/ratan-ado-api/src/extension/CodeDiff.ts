import {
  type GitChange,
  type GitCommitDiffs,
  GitObjectType,
  type GitPullRequest,
  LineDiffBlockChangeType,
  VersionControlChangeType,
} from "azure-devops-node-api/interfaces/GitInterfaces.js";
import { hierarchyQueryRequest } from "./HierarchyQuery";
import type {
  ChangeJson,
  ChangeJsonWithDiff,
  CodeChangeBlock,
} from "./interfaces";

// https://stackoverflow.com/questions/79428941/get-pull-request-file-content-diff-using-azure-devops-rest-api
export async function getCodeDiffFromHierarchyQuery(
  pullrequest: GitPullRequest,
  commitDiff: GitCommitDiffs,
  options?: {
    showLineNumber?: boolean;
    exclusivePaths?: string[];
    includePaths?: string[];
  },
) {
  const repositoryId = pullrequest.repository?.id;
  const latestSourceCommitId = pullrequest.lastMergeSourceCommit?.commitId;
  const latestTargetCommitId = pullrequest.lastMergeTargetCommit?.commitId;

  const differenceText: string[] = [];
  const differenceJson: Array<ChangeJsonWithDiff> = [];

  const changes = filterChanges(commitDiff.changes ?? []);

  for (const change of changes) {
    const { oldFilePath, newFilePath, changeTypeString } = change;
    const exclusivePaths = options?.exclusivePaths ?? ["package-lock.json"];
    const includePaths = options?.includePaths ?? [];

    if (
      exclusivePaths.includes(newFilePath) ||
      exclusivePaths.includes(oldFilePath)
    )
      continue;

    if (includePaths.length > 0 && !includePaths.includes(newFilePath)) {
      continue;
    }

    const body = {
      contributionIds: ["ms.vss-code-web.file-diff-data-provider"],
      dataProviderContext: {
        properties: {
          repositoryId: repositoryId,
          diffParameters: {
            includeCharDiffs: true,
            // yes, source file and commit on modified side, target file and commit on original side
            // strange, but works
            modifiedPath: oldFilePath,
            modifiedVersion: `GC${latestSourceCommitId}`,
            originalPath: newFilePath,
            originalVersion: `GC${latestTargetCommitId}`,
            partialDiff: true,
            forceLoad: false,
          },
        },
      },
    };

    const result = await (hierarchyQueryRequest.call(this, body) as ReturnType<
      typeof hierarchyQueryRequest
    >);

    if (
      !result ||
      !result.dataProviders ||
      !result.dataProviders["ms.vss-code-web.file-diff-data-provider"]
    ) {
      console.error(`No data found for filePath: ${newFilePath}`);
      continue;
    }
    const blocks = result.dataProviders[
      "ms.vss-code-web.file-diff-data-provider"
    ].blocks as CodeChangeBlock[];

    const changeJson = {
      newFilePath: oldFilePath,
      oldFilePath: newFilePath,
      changeType: changeTypeString,
      blocks,
    };

    const difference = prettifyCodeDiff(changeJson, options);

    differenceJson.push({
      ...changeJson,
      changes: difference,
    });

    differenceText.push(difference);
  }
  return {
    differenceText: differenceText.join("\n\n"),
    differenceJson,
  };
}

const prettifyCodeDiff = (
  { newFilePath, oldFilePath, changeType, blocks }: ChangeJson,
  options?: {
    showLineNumber?: boolean;
  },
): string => {
  const showLineNumber = options?.showLineNumber ?? true;

  const codeChanges = blocks
    .map((block) => {
      const { changeType, mLines, oLines, mLine, oLine } = block;
      if (changeType === LineDiffBlockChangeType.None) {
        return oLines
          .map((line, i) => `${showLineNumber ? oLine + i : ""}\t \t${line}`)
          .join("\n");
      } else if (changeType === LineDiffBlockChangeType.Edit) {
        return oLines
          .map((line, i) => `${showLineNumber ? oLine + i : ""}\t-\t${line}`)
          .concat(
            mLines.map(
              (line, i) => `${showLineNumber ? mLine + i : ""}\t+\t${line}`,
            ),
          )
          .join("\n");
      } else if (changeType === LineDiffBlockChangeType.Delete) {
        return oLines
          .map((line, i) => `${showLineNumber ? oLine + i : ""}\t-\t${line}`)
          .join("\n");
      } else if (changeType === LineDiffBlockChangeType.Add) {
        return mLines
          .map((line, i) => `${showLineNumber ? mLine + i : ""}\t+\t${line}`)
          .join("\n");
      }
    })
    .join("\n");

  return `${changeType}\n--- ${oldFilePath}\n+++ ${newFilePath}\n${codeChanges}\n`;
};

export const filterChanges = (changes: GitChange[]) => {
  return changes
    .filter((change) => {
      if (change.item.isFolder) return false;
      if (
        change.item.gitObjectType &&
        !["blob", GitObjectType.Blob].includes(change.item.gitObjectType)
      ) {
        return false;
      }
      return true;
    })
    .map((change) => {
      const changeType = change.changeType;
      let changeTypeString = VersionControlChangeType[changeType] || "Unknown";

      if (
        changeType ===
        VersionControlChangeType.Edit + VersionControlChangeType.Rename
      ) {
        changeTypeString = "Edit/Rename";
      } else if (
        changeType ===
        VersionControlChangeType.Delete + VersionControlChangeType.SourceRename
      ) {
        changeTypeString = "Delete/SourceRename";
      }

      let newFilePath = change.item.path;
      let oldFilePath = change.sourceServerItem || newFilePath;

      // changeType = Add means Deleted
      // changeType = Deleted means Added
      if (changeType === VersionControlChangeType.Add) {
        oldFilePath = "";
        changeTypeString = "Delete";
      } else if (changeType === VersionControlChangeType.Delete) {
        newFilePath = "";
        changeTypeString = "Add";
      }

      return {
        oldFilePath,
        newFilePath,
        changeTypeString,
      };
    });
};
