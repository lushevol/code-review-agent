import type { NormalizedFinding } from "../../types/finding";
import { FINDING_SEVERITY_RANK } from "./finding-priority";
const INLINE_COMMENT_LIMIT = 30;

export interface PreviouslyLinkedFindings {
  findingIds: ReadonlySet<string>;
  contentHashes: ReadonlySet<string>;
}

export function indexPreviouslyLinkedFindings(
  storedFindings: Array<{ id: string; contentHash: string }>,
  links: Array<{ findingId: string }>,
): PreviouslyLinkedFindings {
  const findingIds = new Set(links.map(({ findingId }) => findingId));
  return {
    findingIds,
    contentHashes: new Set(
      storedFindings
        .filter(({ id }) => findingIds.has(id))
        .map(({ contentHash }) => contentHash),
    ),
  };
}

export function isInlinePostable(finding: NormalizedFinding): boolean {
  return (
    finding.filePath !== null &&
    finding.filePath.trim().length > 0 &&
    finding.lineStart !== null &&
    finding.lineStart > 0
  );
}

export function evaluatePostableFindings(
  findings: NormalizedFinding[],
  previouslyLinked: PreviouslyLinkedFindings,
): {
  findings: NormalizedFinding[];
  suppressionReasons: {
    invalidCodeLocation: number;
    duplicateContentHash: number;
    previouslyLinkedThread: number;
    commentLimit: number;
  };
} {
  const suppressionReasons = {
    invalidCodeLocation: 0,
    duplicateContentHash: 0,
    previouslyLinkedThread: 0,
    commentLimit: 0,
  };
  const seenContentHashes = new Set<string>();
  const eligible = findings
    .filter((finding) => {
      if (!isInlinePostable(finding)) {
        suppressionReasons.invalidCodeLocation += 1;
        return false;
      }
      if (
        previouslyLinked.findingIds.has(finding.id) ||
        previouslyLinked.contentHashes.has(finding.contentHash)
      ) {
        suppressionReasons.previouslyLinkedThread += 1;
        return false;
      }
      return true;
    })
    .sort(
      (a, b) =>
        Number(b.blocking) - Number(a.blocking) ||
        FINDING_SEVERITY_RANK[a.severity] - FINDING_SEVERITY_RANK[b.severity],
    )
    .filter((finding) => {
      if (seenContentHashes.has(finding.contentHash)) {
        suppressionReasons.duplicateContentHash += 1;
        return false;
      }
      seenContentHashes.add(finding.contentHash);
      return true;
    });
  suppressionReasons.commentLimit = Math.max(
    0,
    eligible.length - INLINE_COMMENT_LIMIT,
  );
  return {
    findings: eligible.slice(0, INLINE_COMMENT_LIMIT),
    suppressionReasons,
  };
}
