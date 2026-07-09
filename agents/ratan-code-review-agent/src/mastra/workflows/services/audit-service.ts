import { FindingStore } from "finding-store";
import type { AuditRecord } from "../../types/finding";

export class AuditService {
  constructor(private findingStore: FindingStore) {}

  /**
   * Record a review audit record.
   * The record is persisted to the FindingStore's audit_records table.
   */
  async recordReview(auditRecord: AuditRecord): Promise<void> {
    try {
      const now = new Date().toISOString();

      this.findingStore.saveAuditRecord({
        id: auditRecord.id,
        prId: auditRecord.prId,
        repository: auditRecord.repository,
        commitHash: auditRecord.commitHash,
        baseCommitHash: auditRecord.baseCommitHash,
        reviewStartTimestamp: auditRecord.reviewStartTimestamp,
        reviewEndTimestamp: auditRecord.reviewEndTimestamp,
        scanners: auditRecord.scanners,
        modelVersion: auditRecord.modelVersion,
        findingsCount: auditRecord.findingsCount,
        blockingFindingsCount: auditRecord.blockingFindingsCount,
        mergePolicyDecision: auditRecord.mergePolicyDecision,
        supersedesReviewId: auditRecord.supersedesReviewId,
        rawScannerOutputs: auditRecord.rawScannerOutputs,
        createdAt: now,
      });
    } catch (err) {
      console.error(
        `[audit-service] Failed to save audit record: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  /**
   * Get the review history for a specific PR in a repository.
   */
  async getReviewHistory(
    prId: number,
    repository: string,
  ): Promise<AuditRecord[]> {
    try {
      const rows = this.findingStore.queryAuditRecords({
        prId,
        repository,
      });
      return rows as unknown as AuditRecord[];
    } catch (err) {
      console.error(
        `[audit-service] Failed to get review history for PR ${prId}: ${(err as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Get review history within a date range.
   */
  async getReviewHistoryByDateRange(
    from: string,
    to: string,
  ): Promise<AuditRecord[]> {
    try {
      const rows = this.findingStore.queryAuditRecords({
        from,
        to,
      });
      return rows as unknown as AuditRecord[];
    } catch (err) {
      console.error(
        `[audit-service] Failed to get review history by date range: ${(err as Error).message}`,
      );
      return [];
    }
  }
}
