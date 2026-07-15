import { describe, expect, it } from "vitest";
import type { NormalizedFinding } from "../../types/finding";
import {
  isInlinePostable,
  selectPostableFindings,
} from "./finding-eligibility";

describe("isInlinePostable", () => {
  it("requires a non-empty file path and a positive line number", () => {
    expect(isInlinePostable(finding())).toBe(true);
    expect(isInlinePostable(finding({ filePath: null }))).toBe(false);
    expect(isInlinePostable(finding({ filePath: "  " }))).toBe(false);
    expect(isInlinePostable(finding({ lineStart: null }))).toBe(false);
    expect(isInlinePostable(finding({ lineStart: 0 }))).toBe(false);
  });
});

describe("selectPostableFindings", () => {
  it("orders blocking findings before severity-ranked non-blocking findings", () => {
    const selected = selectPostableFindings([
      finding({ id: "11111111-1111-4111-8111-111111111111", contentHash: "low", severity: "low" }),
      finding({ id: "22222222-2222-4222-8222-222222222222", contentHash: "critical", severity: "critical" }),
      finding({ id: "33333333-3333-4333-8333-333333333333", contentHash: "blocking", severity: "medium", blocking: true }),
      finding({ id: "44444444-4444-4444-8444-444444444444", contentHash: "high", severity: "high" }),
    ]);

    expect(selected.map(({ contentHash }) => contentHash)).toEqual([
      "blocking",
      "critical",
      "high",
      "low",
    ]);
  });

  it("emits only the highest-priority finding for each content hash", () => {
    const selected = selectPostableFindings([
      finding({ id: "11111111-1111-4111-8111-111111111111", contentHash: "same", severity: "low" }),
      finding({ id: "22222222-2222-4222-8222-222222222222", contentHash: "same", severity: "high" }),
    ]);

    expect(selected).toHaveLength(1);
    expect(selected[0].severity).toBe("high");
  });

  it("applies the 30-comment cap after prioritization", () => {
    const lowFindings = Array.from({ length: 30 }, (_, index) =>
      finding({
        id: `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
        contentHash: `low-${index}`,
        severity: "low",
      }),
    );
    const selected = selectPostableFindings([
      ...lowFindings,
      finding({
        id: "99999999-9999-4999-8999-999999999999",
        contentHash: "blocking",
        severity: "medium",
        blocking: true,
      }),
    ]);

    expect(selected).toHaveLength(30);
    expect(selected[0].contentHash).toBe("blocking");
    expect(selected.some(({ contentHash }) => contentHash === "low-29")).toBe(false);
  });
});

function finding(overrides: Partial<NormalizedFinding> = {}): NormalizedFinding {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    prId: 7,
    repository: "repo",
    filePath: "/src/file.ts",
    lineStart: 4,
    lineEnd: 4,
    category: "bug",
    severity: "high",
    title: "Finding",
    description: "Description",
    evidence: "Evidence",
    businessImpact: "Impact",
    remediation: "Fix it",
    blocking: false,
    linkedTaskId: null,
    resolution: "open",
    sourceEngine: "open-code-review",
    sourceVersion: "1.0.0",
    supersedesFindingId: null,
    contentHash: "hash",
    createdAt: "2026-07-15T00:00:00.000Z",
    resolvedAt: null,
    ...overrides,
  };
}
