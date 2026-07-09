import type { CodeReviewIssue } from "../types";

const severityOrder = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
} as const;
const priorityOrder = {
  P1: 0,
  P2: 1,
  P3: 2,
  P4: 3,
  P5: 4,
} as const;
export const sortIssues = (errors: Array<CodeReviewIssue>) => {
  return [...errors].sort((a, b) => {
    // Sort by severity (Critical > High > Medium > Low), then by priority (P1 > P2 > P3 > P4 > P5)
    const severityA =
      severityOrder[a.severity as keyof typeof severityOrder] ?? 4;
    const severityB =
      severityOrder[b.severity as keyof typeof severityOrder] ?? 4;
    if (severityA !== severityB) {
      return severityA - severityB;
    }
    const priorityA =
      priorityOrder[a.priority as keyof typeof priorityOrder] ?? 5;
    const priorityB =
      priorityOrder[b.priority as keyof typeof priorityOrder] ?? 5;
    return priorityA - priorityB;
  });
};
