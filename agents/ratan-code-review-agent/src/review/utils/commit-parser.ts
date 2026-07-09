/**
 * Extract ADO work item IDs from an array of commit messages.
 * Handles formats:
 *   - AB#12345, AB#12345, AB#67890
 *   - #12345 (numeric-only, 5+ digits to avoid false matches)
 *   - Fixes 123456, resolves #789
 *   - [ABC-123] (JIRA-style, but with numeric work item IDs)
 *
 * Returns deduplicated, sorted array of numeric IDs.
 */
export function extractAdoWorkItemIds(commitMessages: string[]): number[] {
  const ids = new Set<number>();

  for (const message of commitMessages) {
    // Pattern 1: AB#<digits> (no minimum digit length)
    const abPattern = /AB#(\d+)/gi;
    let match: RegExpExecArray | null;
    while ((match = abPattern.exec(message)) !== null) {
      ids.add(parseInt(match[1], 10));
    }

    // Pattern 2: #<digits> where digits >= 5 (to avoid false matches like #123)
    const hashPattern = /#(\d{5,})\b/g;
    while ((match = hashPattern.exec(message)) !== null) {
      ids.add(parseInt(match[1], 10));
    }

    // Pattern 3: keyword-prefixed standalone digits (fixes 12345, resolves 12345, etc.)
    // Also handles keyword followed by # (e.g., "resolves #12345") via optional #
    const keywordPattern =
      /\b(?:fixes|resolves|closes|related\s+to)\s+(?:#)?(\d{4,})\b/gi;
    while ((match = keywordPattern.exec(message)) !== null) {
      ids.add(parseInt(match[1], 10));
    }

    // Pattern 4: JIRA-style [ABC-12345] - conservative, requires 5+ digits
    const jiraPattern = /\[[A-Za-z]+-(\d{5,})\]/g;
    while ((match = jiraPattern.exec(message)) !== null) {
      ids.add(parseInt(match[1], 10));
    }
  }

  return Array.from(ids).sort((a, b) => a - b);
}
