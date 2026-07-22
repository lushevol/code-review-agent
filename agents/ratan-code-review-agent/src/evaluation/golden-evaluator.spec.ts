import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateGoldenCase,
  goldenTestCaseSchema,
  type GoldenActualFinding,
} from "./golden-evaluator";

const datasetDirectory = path.resolve(
  import.meta.dirname,
  "dataset/golden",
);

describe("golden PR review dataset", () => {
  const cases = fs
    .readdirSync(datasetDirectory)
    .filter((file) => file.endsWith(".json"))
    .map((file) =>
      goldenTestCaseSchema.parse(
        JSON.parse(fs.readFileSync(path.join(datasetDirectory, file), "utf8")),
      ),
    );

  it("contains a broad, uniquely identified multilingual corpus", () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
    expect(new Set(cases.map(({ id }) => id))).toHaveLength(cases.length);
    expect(
      new Set(cases.map(({ language }) => language)).size,
    ).toBeGreaterThanOrEqual(6);
  });

  it("covers required finding categories and clean-change controls", () => {
    const categories = new Set(
      cases.flatMap(({ expectedFindings }) =>
        expectedFindings.map(({ category }) => category),
      ),
    );
    for (const category of [
      "bug",
      "security",
      "maintainability",
      "test",
      "documentation",
    ]) {
      expect(categories.has(category)).toBe(true);
    }
    expect(
      cases.filter(({ expectedFindings }) => expectedFindings.length === 0),
    ).toHaveLength(3);
  });

  it("keeps every expected location inside its changed file", () => {
    for (const testCase of cases) {
      for (const expected of testCase.expectedFindings) {
        const file = testCase.files.find(({ path }) => path === expected.filePath);
        expect(file, `${testCase.id}: ${expected.filePath}`).toBeDefined();
        const lineCount = file!.after.split("\n").length;
        expect(expected.lineStart).toBeGreaterThan(0);
        expect(expected.lineEnd).toBeGreaterThanOrEqual(expected.lineStart);
        expect(expected.lineEnd).toBeLessThanOrEqual(lineCount);
      }
    }
  });
});

describe("evaluateGoldenCase", () => {
  const testCase = goldenTestCaseSchema.parse({
    id: "unit-security",
    language: "typescript",
    title: "Unsafe query",
    description: "Builds SQL from request input",
    files: [
      {
        path: "src/users.ts",
        changeType: "modified",
        before: "export function find(id: string) {}",
        after: [
          "export function find(id: string) {",
          "  return db.query(`SELECT * FROM users WHERE id = ${id}`);",
          "}",
        ].join("\n"),
      },
    ],
    expectedFindings: [
      {
        id: "sql-injection",
        filePath: "src/users.ts",
        lineStart: 2,
        lineEnd: 2,
        category: "security",
        allowedSeverities: ["critical", "high"],
        messageIncludes: ["sql", "parameter"],
      },
    ],
    allowedExtraFindings: 0,
  });

  it("matches location, category, severity, and message concepts", () => {
    const result = evaluateGoldenCase(testCase, [
      finding({
        filePath: "/src/users.ts",
        lineStart: 3,
        lineEnd: 3,
        category: "security",
        severity: "high",
        description: "SQL input must use a parameterized query.",
      }),
    ]);

    expect(result).toMatchObject({
      passed: true,
      matchedExpectationIds: ["sql-injection"],
      missedExpectationIds: [],
      unexpectedFindingIndexes: [],
      metrics: { recall: 1, precision: 1 },
    });
  });

  it("does not let one actual finding satisfy two expectations", () => {
    const duplicateExpectationCase = {
      ...testCase,
      expectedFindings: [
        ...testCase.expectedFindings,
        { ...testCase.expectedFindings[0], id: "second-issue" },
      ],
    };

    const result = evaluateGoldenCase(duplicateExpectationCase, [
      finding({
        category: "security",
        severity: "high",
        description: "SQL should use parameter binding.",
      }),
    ]);

    expect(result.passed).toBe(false);
    expect(result.matchedExpectationIds).toHaveLength(1);
    expect(result.missedExpectationIds).toHaveLength(1);
  });

  it("finds a complete one-to-one assignment when matches overlap", () => {
    const overlappingCase = {
      ...testCase,
      expectedFindings: [
        {
          ...testCase.expectedFindings[0],
          id: "broad",
          allowedSeverities: ["critical", "high"] as const,
        },
        {
          ...testCase.expectedFindings[0],
          id: "high-only",
          allowedSeverities: ["high"] as const,
        },
      ],
    };
    const actual = [
      finding({
        category: "security",
        severity: "high",
        description: "SQL must use a parameterized query.",
      }),
      finding({
        category: "security",
        severity: "critical",
        description: "SQL must use a parameterized query.",
      }),
    ];

    const result = evaluateGoldenCase(overlappingCase, actual);

    expect(result.passed).toBe(true);
    expect(result.matchedExpectationIds).toEqual(["broad", "high-only"]);
    expect(result.unexpectedFindingIndexes).toEqual([]);
  });

  it("fails clean changes when the reviewer hallucinates a finding", () => {
    const cleanCase = { ...testCase, expectedFindings: [] };
    const result = evaluateGoldenCase(cleanCase, [finding()]);

    expect(result).toMatchObject({
      passed: false,
      unexpectedFindingIndexes: [0],
      metrics: { recall: 1, precision: 0 },
    });
  });
});

function finding(
  overrides: Partial<GoldenActualFinding> = {},
): GoldenActualFinding {
  return {
    filePath: "/src/users.ts",
    lineStart: 2,
    lineEnd: 2,
    category: "bug",
    severity: "medium",
    title: "Unsafe query",
    description: "Review this query",
    remediation: "Use a safer implementation",
    ...overrides,
  };
}
