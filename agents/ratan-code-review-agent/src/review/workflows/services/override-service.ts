import { FindingStore } from "finding-store";

export interface OverrideRequest {
  findingId: string;
  requestedBy: string;
  newResolution: "waived" | "false-positive" | "accepted-risk";
  justification: string;
  secondApprover?: string;
  expiryDate?: string; // ISO date for waived/accepted-risk
}

export class OverrideService {
  constructor(private findingStore: FindingStore) {}

  /**
   * Request an override for a finding.
   * - Critical severity requires two-person approval (secondApprover required).
   * - High and below: a single authorized user is sufficient.
   */
  async requestOverride(request: OverrideRequest): Promise<void> {
    const finding = this.findingStore.getFindingById(request.findingId);
    if (!finding) {
      throw new Error(`Finding not found: ${request.findingId}`);
    }

    // ── Authorization check ───────────────────────────────────────────
    if (finding.severity === "critical") {
      if (!request.secondApprover) {
        throw new Error(
          `Critical findings require two-person approval. Provide a secondApprover.`,
        );
      }
    }

    // ── Log the override and update the finding's resolution ──────────
    this.findingStore.updateResolution(
      request.findingId,
      request.newResolution,
      {
        overriddenBy: request.requestedBy,
        justification: request.justification,
        secondApprover: request.secondApprover,
        expiryDate: request.expiryDate,
      },
    );
  }

  /**
   * Approve a pending critical override.
   * Updates the override log with the second approver identity.
   */
  async approveOverride(findingId: string, approvedBy: string): Promise<void> {
    const finding = this.findingStore.getFindingById(findingId);
    if (!finding) {
      throw new Error(`Finding not found: ${findingId}`);
    }

    // Re-apply the override with the second approval recorded
    this.findingStore.updateResolution(findingId, finding.resolution, {
      overriddenBy: approvedBy,
      secondApprover: approvedBy,
    });
  }

  /**
   * Extend the expiry date of an active override.
   */
  async renewOverride(findingId: string, newExpiryDate: string): Promise<void> {
    const finding = this.findingStore.getFindingById(findingId);
    if (!finding) {
      throw new Error(`Finding not found: ${findingId}`);
    }

    // Write a fresh override log entry with the updated expiry
    this.findingStore.updateResolution(findingId, finding.resolution, {
      overriddenBy: "system",
      justification: "Override renewed",
      expiryDate: newExpiryDate,
    });
  }

  /**
   * Return all overrides that have passed their expiry date.
   */
  async getExpiredOverrides(): Promise<
    { findingId: string; resolution: string }[]
  > {
    return this.findingStore.getExpiredOverrides();
  }

  /**
   * Process expired overrides by reverting them back to 'open'.
   * Returns the count of overrides that were reverted.
   */
  async processExpiredOverrides(): Promise<number> {
    const expired = this.findingStore.getExpiredOverrides();
    let revertedCount = 0;

    for (const entry of expired) {
      try {
        const finding = this.findingStore.getFindingById(entry.findingId);
        if (finding && finding.resolution !== "open") {
          // Reset resolution back to 'open' without logging an override
          // Use the underlying store's updateResolution with no override log entry
          this.findingStore.updateResolution(entry.findingId, "open");
          revertedCount++;
        }
      } catch (err) {
        console.warn(
          `[override-service] Failed to revert override for finding ${entry.findingId}: ${(err as Error).message}`,
        );
      }
    }

    return revertedCount;
  }
}
