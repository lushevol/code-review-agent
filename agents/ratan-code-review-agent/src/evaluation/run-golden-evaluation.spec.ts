import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OcrReviewOutput } from "../review/open-code-review/runner";
import { goldenTestCaseSchema } from "./golden-evaluator";
import {
  assertSafeExecution,
  evaluateOcrOutput,
  loadCases,
  materializeCase,
  parseOptions,
  selectCases,
} from "./run-golden-evaluation";

describe("golden evaluation command", () => {
  it("parses repeated case selection, config, and dry-run options", () => {
    const options = parseOptions([
      "--case",
      "first",
      "--case",
      "second",
      "--config",
      "/tmp/config",
      "--dry-run",
      "--judge",
    ]);
    expect(options).toEqual({
      caseIds: new Set(["first", "second"]),
      configPath: "/tmp/config",
      dryRun: true,
      judge: true,
    });
    expect(() => parseOptions(["--unknown"])).toThrow("Unknown option");
    expect(() => parseOptions(["--case"])).toThrow("requires a value");
  });

  it("loads the corpus and selects only requested IDs", () => {
    const cases = loadCases();
    expect(selectCases(cases, new Set())).toHaveLength(27);
    expect(selectCases(cases, new Set(["ts-sql-injection"]))).toEqual([
      expect.objectContaining({ id: "ts-sql-injection" }),
    ]);
  });

  it("requires explicit case selection before live evaluation", () => {
    expect(() => assertSafeExecution({ caseIds: new Set(), dryRun: false, judge: false }))
      .toThrow("requires at least one --case");
    expect(() => assertSafeExecution({ caseIds: new Set(), dryRun: true, judge: false }))
      .not.toThrow();
    expect(() => assertSafeExecution({
      caseIds: new Set(["ts-sql-injection"]),
      dryRun: false,
      judge: true,
    })).not.toThrow();
  });

  it.each(["skipped", "completed_with_errors"] as const)(
    "fails a clean case when OCR status is %s",
    (status) => {
      const result = evaluateOcrOutput(cleanCase(), output({
        status,
        complete: status !== "completed_with_errors",
      }));
      expect(result.evaluation.passed).toBe(true);
      expect(result.passed).toBe(false);
    },
  );

  it("passes a successful clean review with no findings", () => {
    expect(evaluateOcrOutput(cleanCase(), output()).passed).toBe(true);
  });

  it("materializes added and modified files as a two-commit repository", () => {
    const testCase = goldenTestCaseSchema.parse({
      id: "materialization",
      language: "typescript",
      title: "Materialize changes",
      description: "Exercise the local Git boundary",
      files: [
        {
          path: "src/modified.ts",
          changeType: "modified",
          before: "export const value = 1;",
          after: "export const value = 2;",
        },
        {
          path: "src/added.ts",
          changeType: "added",
          after: "export const added = true;",
        },
      ],
      expectedFindings: [],
    });
    const workspace = materializeCase(testCase);
    const root = path.dirname(workspace.repoPath);

    try {
      expect(git(workspace.repoPath, "show", `${workspace.mergeBaseCommit}:src/modified.ts`))
        .toBe("export const value = 1;");
      expect(() => git(workspace.repoPath, "show", `${workspace.mergeBaseCommit}:src/added.ts`))
        .toThrow();
      expect(git(workspace.repoPath, "show", `${workspace.headCommit}:src/modified.ts`))
        .toBe("export const value = 2;");
      expect(git(workspace.repoPath, "show", `${workspace.headCommit}:src/added.ts`))
        .toBe("export const added = true;");
      expect(workspace.changes.map(({ status }) => status)).toEqual([
        "modified",
        "added",
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
    expect(fs.existsSync(root)).toBe(false);
  });

  it("materializes a deleted file in the synthetic PR", () => {
    const testCase = goldenTestCaseSchema.parse({
      id: "deleted-file",
      language: "typescript",
      title: "Delete obsolete code",
      description: "Exercise deletion materialization",
      files: [
        {
          path: "src/obsolete.ts",
          changeType: "deleted",
          before: "export const obsolete = true;",
        },
      ],
      expectedFindings: [],
    });
    const workspace = materializeCase(testCase);
    const root = path.dirname(workspace.repoPath);

    try {
      expect(git(workspace.repoPath, "show", `${workspace.mergeBaseCommit}:src/obsolete.ts`))
        .toBe("export const obsolete = true;");
      expect(() => git(workspace.repoPath, "show", `${workspace.headCommit}:src/obsolete.ts`))
        .toThrow();
      expect(workspace.changes).toEqual([
        { path: "src/obsolete.ts", status: "deleted", addedLines: [] },
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("materializes a renamed file with its previous path", () => {
    const testCase = goldenTestCaseSchema.parse({
      id: "renamed-file",
      language: "typescript",
      title: "Rename a module",
      description: "Exercise rename materialization",
      files: [
        {
          path: "src/current.ts",
          previousPath: "src/legacy.ts",
          changeType: "renamed",
          before: "export const value = 1;",
          after: "export const value = 1;",
        },
      ],
      expectedFindings: [],
    });
    const workspace = materializeCase(testCase);
    const root = path.dirname(workspace.repoPath);

    try {
      expect(git(workspace.repoPath, "show", `${workspace.mergeBaseCommit}:src/legacy.ts`))
        .toBe("export const value = 1;");
      expect(() => git(workspace.repoPath, "show", `${workspace.headCommit}:src/legacy.ts`))
        .toThrow();
      expect(git(workspace.repoPath, "show", `${workspace.headCommit}:src/current.ts`))
        .toBe("export const value = 1;");
      expect(workspace.changes[0]).toMatchObject({
        path: "src/current.ts",
        previousPath: "src/legacy.ts",
        status: "renamed",
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

function cleanCase() {
  return goldenTestCaseSchema.parse({
    id: "clean",
    language: "typescript",
    title: "Clean change",
    description: "No findings expected",
    files: [{ path: "src/clean.ts", changeType: "added", after: "export const ok = true;" }],
    expectedFindings: [],
  });
}

function output(overrides: Partial<OcrReviewOutput> = {}): OcrReviewOutput {
  return {
    status: "success",
    comments: [],
    warnings: [],
    complete: true,
    durationMs: 1,
    ...overrides,
  };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}
