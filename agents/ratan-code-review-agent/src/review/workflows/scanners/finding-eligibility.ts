import type { NormalizedFinding } from "../../types/finding";
import { FINDING_SEVERITY_RANK } from "./finding-priority";
const INLINE_COMMENT_LIMIT = 30;

export function isInlinePostable(finding: NormalizedFinding): boolean {
  return (
    finding.filePath !== null &&
    finding.filePath.trim().length > 0 &&
    finding.lineStart !== null &&
    finding.lineStart > 0
  );
}

export function selectPostableFindings(
  findings: NormalizedFinding[],
): NormalizedFinding[] {
  const seenContentHashes = new Set<string>();
  return findings
    .filter(isInlinePostable)
    .sort(
      (a, b) =>
        Number(b.blocking) - Number(a.blocking) ||
        FINDING_SEVERITY_RANK[a.severity] - FINDING_SEVERITY_RANK[b.severity],
    )
    .filter((finding) => {
      if (seenContentHashes.has(finding.contentHash)) return false;
      seenContentHashes.add(finding.contentHash);
      return true;
    })
    .slice(0, INLINE_COMMENT_LIMIT);
}
