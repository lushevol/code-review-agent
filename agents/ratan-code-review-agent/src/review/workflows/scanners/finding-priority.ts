import type { FindingSeverity } from "../../types/finding";

export const FINDING_SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  informational: 4,
};
