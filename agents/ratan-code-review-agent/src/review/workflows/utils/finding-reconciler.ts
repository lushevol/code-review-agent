import type { NormalizedFinding } from "../../types/finding";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ReconciliationResult {
  /** Completely new findings with no match in the old set (resolution: 'open'). */
  findingsToCreate: NormalizedFinding[];
  /** IDs of old findings that are superseded by a new finding. */
  findingsToSupersede: string[];
  /** IDs of old findings that no longer appear and should be marked resolved. */
  findingsToResolve: string[];
  /** IDs of old findings to preserve unchanged (e.g., active overrides). */
  findingsToKeep: string[];
}

export interface FindingReconciliationStore {
  batchUpsert(findings: NormalizedFinding[]): NormalizedFinding[];
  getFindingsByPr(prId: number, repository: string): NormalizedFinding[];
  updateResolution(id: string, resolution: string): void;
}

export interface PersistedReconciliationResult extends ReconciliationResult {
  findings: NormalizedFinding[];
}

// ─── Constants ─────────────────────────────────────────────────────────────

const LINE_FALLBACK_RANGE = 3;

/**
 * Resolutions considered "active overrides" — a human has deliberately
 * overridden the default open/superseded behavior.
 */
const ACTIVE_OVERRIDE_RESOLUTIONS = new Set([
  "waived",
  "false-positive",
  "accepted-risk",
]);

// ─── Helpers ───────────────────────────────────────────────────────────────

function hasActiveOverride(finding: NormalizedFinding): boolean {
  return ACTIVE_OVERRIDE_RESOLUTIONS.has(finding.resolution);
}

/**
 * Primary match: two findings share the same content hash.
 */
function matchByContentHash(
  oldFinding: NormalizedFinding,
  newFindingsByHash: Map<string, NormalizedFinding>,
): NormalizedFinding | undefined {
  return newFindingsByHash.get(oldFinding.contentHash);
}

/**
 * Fallback match: two findings share (filePath, nearby line, sourceEngine, category).
 * Used when content hashes diverge but the location is essentially the same
 * (e.g., a minor text change in a comment shifted the hash).
 */
function matchByLocation(
  oldFinding: NormalizedFinding,
  newFindings: NormalizedFinding[],
): NormalizedFinding | undefined {
  if (
    !oldFinding.filePath ||
    oldFinding.lineStart === null ||
    !oldFinding.sourceEngine
  ) {
    return undefined;
  }

  return newFindings.find((nf) => {
    if (!nf.filePath || nf.lineStart === null) return false;
    return (
      nf.filePath === oldFinding.filePath &&
      Math.abs(nf.lineStart - oldFinding.lineStart) <= LINE_FALLBACK_RANGE &&
      nf.sourceEngine === oldFinding.sourceEngine &&
      nf.category === oldFinding.category
    );
  });
}

// ─── Reconciliation ────────────────────────────────────────────────────────

/**
 * Reconcile old findings (from a previous review) with new findings
 * (from the current scan). Returns structured actions for the caller
 * to persist.
 *
 * Matching priority:
 * 1. Same `contentHash` within the same PR (primary)
 * 2. Same `(filePath, lineStart +/- 3, sourceEngine, category)` (fallback)
 */
export function reconcileFindings(
  oldFindings: NormalizedFinding[],
  newFindings: NormalizedFinding[],
): ReconciliationResult {
  const findingsToSupersede: string[] = [];
  const findingsToResolve: string[] = [];
  const findingsToKeep: string[] = [];
  const findingsToCreate: NormalizedFinding[] = [];

  // Track which new findings have been matched to an old one
  const matchedNewIndices = new Set<number>();

  // Index new findings by content hash for fast lookups
  const newByHash = new Map<string, NormalizedFinding>();
  for (let i = 0; i < newFindings.length; i++) {
    const nf = newFindings[i];
    // If multiple new findings share the same hash, keep the first
    if (!newByHash.has(nf.contentHash)) {
      newByHash.set(nf.contentHash, nf);
    }
  }

  // ── Reconcile old findings ──────────────────────────────────────────────
  for (const old of oldFindings) {
    // Preserve active overrides unchanged
    if (hasActiveOverride(old)) {
      findingsToKeep.push(old.id);
      continue;
    }

    // Primary: content hash match
    const hashMatch = matchByContentHash(old, newByHash);

    if (hashMatch) {
      // The old finding is superseded by this new one
      findingsToSupersede.push(old.id);
      hashMatch.supersedesFindingId = old.id;
      const idx = newFindings.indexOf(hashMatch);
      if (idx !== -1) matchedNewIndices.add(idx);
      continue;
    }

    // Fallback: location-based match
    const locationMatch = matchByLocation(old, newFindings);

    if (locationMatch) {
      findingsToSupersede.push(old.id);
      locationMatch.supersedesFindingId = old.id;
      const idx = newFindings.indexOf(locationMatch);
      if (idx !== -1) matchedNewIndices.add(idx);
      continue;
    }

    // No match — the issue has been resolved between reviews
    findingsToResolve.push(old.id);
  }

  // ── Gather truly new findings ───────────────────────────────────────────
  for (let i = 0; i < newFindings.length; i++) {
    if (!matchedNewIndices.has(i)) {
      const nf = newFindings[i];
      // Ensure the new finding has no supersedes link (it's truly new)
      if (!nf.supersedesFindingId) {
        findingsToCreate.push({ ...nf, resolution: "open" as const });
      } else {
        // Already linked via supersedes, but still needs to be created
        // (the caller is expected to persist all new findings)
        findingsToCreate.push(nf);
      }
    }
  }

  return {
    findingsToCreate,
    findingsToSupersede,
    findingsToResolve,
    findingsToKeep,
  };
}

export function reconcileAndPersistFindings(
  store: FindingReconciliationStore,
  prId: number,
  repository: string,
  newFindings: NormalizedFinding[],
  reviewExecutionStatus: "complete" | "incomplete",
): PersistedReconciliationResult {
  const previous = store.getFindingsByPr(prId, repository).filter(
    (finding) => finding.resolution !== "resolved" &&
      finding.resolution !== "superseded",
  );

  if (reviewExecutionStatus === "incomplete") {
    return {
      findings: store.batchUpsert(newFindings),
      findingsToCreate: [],
      findingsToSupersede: [],
      findingsToResolve: [],
      findingsToKeep: previous.map((finding) => finding.id),
    };
  }

  const reconciled = reconcileFindings(previous, newFindings);
  for (const id of reconciled.findingsToResolve) {
    store.updateResolution(id, "resolved");
  }
  for (const id of reconciled.findingsToSupersede) {
    store.updateResolution(id, "superseded");
  }

  return {
    ...reconciled,
    findings: store.batchUpsert(newFindings),
  };
}
