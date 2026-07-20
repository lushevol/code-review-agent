import type {
  AuditRecord,
  FindingEngine,
  FindingCommentThread,
  FindingResolution,
  NormalizedFinding,
} from "./index";

/**
 * In-memory implementation of the FindingStore interface.
 *
 * Useful for testing — no SQLite dependency, no disk I/O, no initialization required.
 *
 * Key semantics mirror the SQLite FindingStore:
 * - `upsertFinding` uses (prId, contentHash, sourceEngine) as the identity key.
 * - An overwrite updates the finding in-place and preserves the id.
 * - `updateResolution` sets resolution and, when "resolved", records resolvedAt.
 */
export class MemoryFindingStore {
  private findings: Map<string, NormalizedFinding> = new Map();
  private auditRecords: AuditRecord[] = [];
  private commentThreads: FindingCommentThread[] = [];

  init(_dbPath?: string): void {
    // No-op; in-memory store is ready immediately.
  }

  /**
   * Insert a finding or update it if one with the same
   * (prId, contentHash, sourceEngine) already exists.
   */
  upsertFinding(finding: NormalizedFinding): NormalizedFinding {
    const existing = this.findByKey(
      finding.prId,
      finding.contentHash,
      finding.sourceEngine,
    );
    if (existing) {
      const merged: NormalizedFinding = { ...existing, ...finding };
      this.findings.set(merged.id, merged);
      return merged;
    }
    this.findings.set(finding.id, finding);
    return finding;
  }

  /**
   * Upsert multiple findings. Returns results in the same order as the input.
   */
  batchUpsert(findings: NormalizedFinding[]): NormalizedFinding[] {
    return findings.map((f) => this.upsertFinding(f));
  }

  /**
   * Get all findings for a given PR in a repository.
   */
  getFindingsByPr(prId: number, repository: string): NormalizedFinding[] {
    return Array.from(this.findings.values()).filter(
      (f) => f.prId === prId && f.repository === repository,
    );
  }

  /**
   * Get a single finding by its ID.
   */
  getFindingById(id: string): NormalizedFinding | null {
    return this.findings.get(id) ?? null;
  }

  linkCommentThread(
    thread: Omit<FindingCommentThread, "createdAt">,
  ): void {
    const finding = this.getFindingById(thread.findingId);
    if (
      !finding ||
      finding.prId !== thread.prId ||
      finding.repository !== thread.repository
    ) {
      throw new Error("Comment thread must belong to the finding's PR and repository");
    }
    if (
      this.commentThreads.some(
        (existing) =>
          existing.repository === thread.repository &&
          existing.prId === thread.prId &&
          existing.threadId === thread.threadId,
      )
    ) {
      return;
    }
    this.commentThreads.push({ ...thread, createdAt: new Date().toISOString() });
  }

  getCommentThreadsByPr(
    prId: number,
    repository: string,
  ): FindingCommentThread[] {
    return this.commentThreads.filter(
      (thread) => thread.prId === prId && thread.repository === repository,
    );
  }

  /**
   * Update the resolution of a finding. When resolution is "resolved",
   * also sets `resolvedAt`. When `options.overriddenBy` is provided,
   * writes an override log entry (recorded in memory).
   */
  updateResolution(
    id: string,
    resolution: FindingResolution,
    options?: {
      overriddenBy?: string;
      justification?: string;
      secondApprover?: string;
      expiryDate?: string;
    },
  ): void {
    const finding = this.findings.get(id);
    if (!finding) {
      throw new Error(`Finding not found: ${id}`);
    }

    const oldResolution = finding.resolution;
    finding.resolution = resolution;

    if (resolution === "resolved") {
      finding.resolvedAt = new Date().toISOString();
    }

    // Write override log entry when overriddenBy is provided
    if (options?.overriddenBy) {
      this.overrideLog.push({
        findingId: id,
        overriddenBy: options.overriddenBy,
        oldResolution,
        newResolution: resolution,
        justification: options.justification ?? null,
        secondApprover: options.secondApprover ?? null,
        expiryDate: options.expiryDate ?? null,
        createdAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Find findings by content hash within a PR.
   */
  getFindingsByContentHash(prId: number, hash: string): NormalizedFinding[] {
    return Array.from(this.findings.values()).filter(
      (f) => f.prId === prId && f.contentHash === hash,
    );
  }

  /**
   * Find findings by source engine.
   */
  getFindingsByEngine(engine: FindingEngine): NormalizedFinding[] {
    return Array.from(this.findings.values()).filter(
      (f) => f.sourceEngine === engine,
    );
  }

  /**
   * Persist an audit record.
   */
  saveAuditRecord(record: AuditRecord): void {
    this.auditRecords.push(record);
  }

  /**
   * Query audit records with optional filters.
   */
  queryAuditRecords(filters: {
    prId?: number;
    repository?: string;
    from?: string;
    to?: string;
  }): AuditRecord[] {
    let results = [...this.auditRecords];

    if (filters.prId !== undefined) {
      results = results.filter((r) => r.prId === filters.prId);
    }
    if (filters.repository !== undefined) {
      results = results.filter((r) => r.repository === filters.repository);
    }
    if (filters.from !== undefined) {
      results = results.filter((r) => r.createdAt >= filters.from!);
    }
    if (filters.to !== undefined) {
      results = results.filter((r) => r.createdAt <= filters.to!);
    }

    return results;
  }

  /**
   * Get findings whose overrides have expired.
   * The in-memory implementation does not track expiration, so this always
   * returns an empty array.
   */
  getExpiredOverrides(): { findingId: string; resolution: string }[] {
    return [];
  }

  /**
   * Clear all stored data. Intended for test teardown.
   */
  close(): void {
    this.findings.clear();
    this.auditRecords = [];
    this.commentThreads = [];
    this.overrideLog = [];
  }

  // ─── Private helpers ───────────────────────────────────────────────────

  /** Override log entries for inspection in tests. */
  private overrideLog: Array<{
    findingId: string;
    overriddenBy: string;
    oldResolution: string;
    newResolution: string;
    justification: string | null;
    secondApprover: string | null;
    expiryDate: string | null;
    createdAt: string;
  }> = [];

  private findByKey(
    prId: number,
    contentHash: string,
    sourceEngine: string,
  ): NormalizedFinding | undefined {
    return Array.from(this.findings.values()).find(
      (f) =>
        f.prId === prId &&
        f.contentHash === contentHash &&
        f.sourceEngine === sourceEngine,
    );
  }
}
