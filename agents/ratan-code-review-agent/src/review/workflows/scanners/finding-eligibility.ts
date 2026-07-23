import type { NormalizedFinding } from "../../types/finding";
import { FINDING_SEVERITY_RANK } from "./finding-priority";

/**
 * When content hashes diverge between runs (e.g. LLM non-determinism in OCR's
 * `existing_code` field), the location fallback prevents duplicate comments for
 * the same finding at the same (filePath, line, engine, category).
 */
const LOCATION_FALLBACK_RANGE = 3;

export interface PreviouslyLinkedLocation {
  filePath: string;
  lineStart: number;
  sourceEngine: string;
  category: string;
}

export interface PreviouslyLinkedFindings {
  findingIds: ReadonlySet<string>;
  contentHashes: ReadonlySet<string>;
  /** Locations of previously-linked findings for fallback dedup when contentHash varies. */
  locations?: PreviouslyLinkedLocation[];
}

export function indexPreviouslyLinkedFindings(
  storedFindings: Array<{
    id: string;
    contentHash: string;
    filePath?: string | null;
    lineStart?: number | null;
    sourceEngine?: string;
    category?: string;
  }>,
  links: Array<{ findingId: string }>,
): PreviouslyLinkedFindings {
  const findingIds = new Set(links.map(({ findingId }) => findingId));
  const linked = storedFindings.filter(({ id }) => findingIds.has(id));
  return {
    findingIds,
    contentHashes: new Set(linked.map(({ contentHash }) => contentHash)),
    locations: linked
      .filter(
        (f): f is typeof f & { filePath: string; lineStart: number } =>
          typeof f.filePath === "string" &&
          f.filePath.length > 0 &&
          typeof f.lineStart === "number" &&
          f.lineStart > 0,
      )
      .map(({ filePath, lineStart, sourceEngine, category }) => ({
        filePath,
        lineStart,
        sourceEngine: sourceEngine ?? "",
        category: category ?? "",
      })),
  };
}

function isLocationMatched(
  finding: NormalizedFinding,
  locations: PreviouslyLinkedLocation[],
): boolean {
  if (!finding.filePath || finding.lineStart === null || finding.lineStart <= 0) {
    return false;
  }
  return locations.some(
    (loc) =>
      loc.filePath === finding.filePath &&
      Math.abs(loc.lineStart - finding.lineStart) <= LOCATION_FALLBACK_RANGE &&
      loc.sourceEngine === finding.sourceEngine &&
      loc.category === finding.category,
  );
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
  inlineCommentLimit: number = 30,
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
        previouslyLinked.contentHashes.has(finding.contentHash) ||
        isLocationMatched(finding, previouslyLinked.locations ?? [])
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
    eligible.length - inlineCommentLimit,
  );
  return {
    findings: eligible.slice(0, inlineCommentLimit),
    suppressionReasons,
  };
}
