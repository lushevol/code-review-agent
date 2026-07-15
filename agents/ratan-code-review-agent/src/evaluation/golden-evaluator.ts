import z from "zod";
import { FindingCategory, FindingSeverity } from "../review/types/finding";

const goldenFileSchema = z.object({
  path: z.string().min(1),
  changeType: z.enum(["added", "modified"]),
  before: z.string().default(""),
  after: z.string(),
});

const goldenExpectedFindingSchema = z.object({
  id: z.string().min(1),
  filePath: z.string().min(1),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  lineTolerance: z.number().int().min(0).default(1),
  category: FindingCategory,
  allowedSeverities: z.array(FindingSeverity).min(1),
  messageIncludes: z.array(z.string().min(1)).min(1),
});

export const goldenTestCaseSchema = z.object({
  id: z.string().min(1),
  language: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  files: z.array(goldenFileSchema).min(1),
  expectedFindings: z.array(goldenExpectedFindingSchema),
  allowedExtraFindings: z.number().int().min(0).default(0),
});

export type GoldenTestCase = z.infer<typeof goldenTestCaseSchema>;

const goldenActualFindingSchema = z.object({
  filePath: z.string(),
  lineStart: z.number().int().nullable(),
  lineEnd: z.number().int().nullable(),
  category: FindingCategory,
  severity: FindingSeverity,
  title: z.string(),
  description: z.string(),
  remediation: z.string(),
});

export type GoldenActualFinding = z.infer<typeof goldenActualFindingSchema>;

export interface GoldenEvaluationResult {
  passed: boolean;
  matchedExpectationIds: string[];
  missedExpectationIds: string[];
  unexpectedFindingIndexes: number[];
  metrics: {
    recall: number;
    precision: number;
  };
}

export function evaluateGoldenCase(
  input: GoldenTestCase,
  actualInput: GoldenActualFinding[],
): GoldenEvaluationResult {
  const testCase = goldenTestCaseSchema.parse(input);
  const actualFindings = actualInput.map((finding) =>
    goldenActualFindingSchema.parse(finding),
  );
  const expectedToActual = findMaximumMatching(testCase, actualFindings);
  const matchedActualIndexes = new Set(expectedToActual.values());
  const matchedExpectationIds = testCase.expectedFindings.flatMap(
    (expected, index) => expectedToActual.has(index) ? [expected.id] : [],
  );
  const missedExpectationIds = testCase.expectedFindings.flatMap(
    (expected, index) => expectedToActual.has(index) ? [] : [expected.id],
  );

  const unexpectedFindingIndexes = actualFindings.flatMap((_, index) =>
    matchedActualIndexes.has(index) ? [] : [index],
  );
  const expectedCount = testCase.expectedFindings.length;
  const actualCount = actualFindings.length;

  return {
    passed:
      missedExpectationIds.length === 0 &&
      unexpectedFindingIndexes.length <= testCase.allowedExtraFindings,
    matchedExpectationIds,
    missedExpectationIds,
    unexpectedFindingIndexes,
    metrics: {
      recall:
        expectedCount === 0
          ? 1
          : matchedExpectationIds.length / expectedCount,
      precision:
        actualCount === 0 ? 1 : matchedActualIndexes.size / actualCount,
    },
  };
}

function findMaximumMatching(
  testCase: GoldenTestCase,
  actualFindings: GoldenActualFinding[],
): Map<number, number> {
  const actualToExpected = new Map<number, number>();

  const assign = (expectedIndex: number, visited: Set<number>): boolean => {
    for (let actualIndex = 0; actualIndex < actualFindings.length; actualIndex += 1) {
      if (visited.has(actualIndex)) continue;
      if (!matchesExpectation(
        testCase.expectedFindings[expectedIndex],
        actualFindings[actualIndex],
      )) continue;
      visited.add(actualIndex);
      const previousExpected = actualToExpected.get(actualIndex);
      if (previousExpected === undefined || assign(previousExpected, visited)) {
        actualToExpected.set(actualIndex, expectedIndex);
        return true;
      }
    }
    return false;
  };

  for (let expectedIndex = 0; expectedIndex < testCase.expectedFindings.length; expectedIndex += 1) {
    assign(expectedIndex, new Set());
  }

  return new Map(
    Array.from(actualToExpected, ([actualIndex, expectedIndex]) => [
      expectedIndex,
      actualIndex,
    ]),
  );
}

function matchesExpectation(
  expected: GoldenTestCase["expectedFindings"][number],
  actual: GoldenActualFinding,
): boolean {
  if (normalizePath(actual.filePath) !== normalizePath(expected.filePath)) {
    return false;
  }
  if (actual.lineStart === null || actual.lineEnd === null) return false;
  const expectedStart = expected.lineStart - expected.lineTolerance;
  const expectedEnd = expected.lineEnd + expected.lineTolerance;
  if (actual.lineEnd < expectedStart || actual.lineStart > expectedEnd) {
    return false;
  }
  if (actual.category !== expected.category) return false;
  if (!expected.allowedSeverities.includes(actual.severity)) return false;

  const searchable = [actual.title, actual.description, actual.remediation]
    .join(" ")
    .toLowerCase();
  return expected.messageIncludes.every((term) =>
    searchable.includes(term.toLowerCase()),
  );
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");
}
