import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { loadConfig } from "../cli/config/loader";
import {
  OpenCodeReviewRunner,
  type OcrReviewOutput,
} from "../review/open-code-review/runner";
import type { ReviewWorkspace } from "../review/workspace/types";
import {
  evaluateGoldenCase,
  goldenTestCaseSchema,
  type GoldenActualFinding,
  type GoldenTestCase,
} from "./golden-evaluator";
import {
  LlmEvaluationJudge,
  type EvaluationJudge,
  type QualitativeJudgement,
} from "./judge";

export interface GoldenEvaluationOptions {
  caseIds: Set<string>;
  configPath?: string;
  dryRun: boolean;
  judge: boolean;
}

export interface GoldenCaseRunResult {
  id: string;
  status: OcrReviewOutput["status"];
  passed: boolean;
  findings: GoldenActualFinding[];
  evaluation: ReturnType<typeof evaluateGoldenCase>;
  qualitative?: Array<{ findingIndex: number; judgement: QualitativeJudgement }>;
}

const workspaceRoot = path.resolve(import.meta.dirname, "../../../..");
dotenv.config({ path: path.join(workspaceRoot, ".env"), quiet: true });

export async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  assertSafeExecution(options);
  const cases = selectCases(loadCases(), options.caseIds);
  if (cases.length === 0) throw new Error("No golden cases matched the selection");

  if (options.dryRun) {
    console.log(JSON.stringify({ cases: cases.length, ids: cases.map(({ id }) => id) }, null, 2));
    return;
  }

  const defaultConfigPath = path.join(workspaceRoot, ".ratan");
  const { provider } = await loadConfig(options.configPath ?? defaultConfigPath);
  const config = await provider.getRootConfig();
  const runner = new OpenCodeReviewRunner();
  const judge = options.judge ? new LlmEvaluationJudge({
    url: config.openCodeReview.llm.url,
    token: config.openCodeReview.llm.token,
    model: config.openCodeReview.llm.model,
    protocol: config.openCodeReview.llm.protocol,
  }) : null;
  const results = [];

  for (const testCase of cases) {
    const workspace = materializeCase(testCase);
    try {
      const output = await runner.review({
        workspace,
        background: [
          `# Synthetic pull request: ${testCase.title}`,
          "",
          testCase.description,
          "",
          "Review only the changed code. Report concrete, actionable defects.",
        ].join("\n"),
        llm: {
          url: config.openCodeReview.llm.url,
          token: config.openCodeReview.llm.token,
          model: config.openCodeReview.llm.model,
          protocol: config.openCodeReview.llm.protocol,
        },
        ruleFile: provider.resolveConfigPath(config.openCodeReview.rulesPath),
      });
      const result = evaluateOcrOutput(testCase, output);
      if (judge) result.qualitative = await judgeFindings(testCase, result, judge);
      results.push(result);
    } finally {
      fs.rmSync(path.dirname(workspace.repoPath), { recursive: true, force: true });
    }
  }

  const passed = results.filter((result) => result.passed).length;
  const summary = {
    passed,
    failed: results.length - passed,
    total: results.length,
    results,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (passed !== results.length) process.exitCode = 1;
}

export function assertSafeExecution(options: GoldenEvaluationOptions): void {
  if (!options.dryRun && options.caseIds.size === 0) {
    throw new Error("Live golden evaluation requires at least one --case <id>");
  }
}

export function loadCases(): GoldenTestCase[] {
  const directory = path.resolve(import.meta.dirname, "dataset/golden");
  return fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) =>
      goldenTestCaseSchema.parse(
        JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")),
      ),
    );
}

export function selectCases(
  cases: GoldenTestCase[],
  caseIds: Set<string>,
): GoldenTestCase[] {
  return cases.filter(
    (testCase) => caseIds.size === 0 || caseIds.has(testCase.id),
  );
}

export function materializeCase(testCase: GoldenTestCase): ReviewWorkspace {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ratan-golden-"));
  const repoPath = path.join(root, "repo");
  const runDirectory = path.join(root, "run");
  fs.mkdirSync(repoPath);
  fs.mkdirSync(runDirectory);
  git(repoPath, "init", "--quiet");
  git(repoPath, "config", "user.email", "golden-tests@example.invalid");
  git(repoPath, "config", "user.name", "Golden Tests");

  for (const file of testCase.files) {
    if (file.changeType !== "added") writeFile(repoPath, file.path, file.before);
  }
  git(repoPath, "add", ".");
  git(repoPath, "commit", "--quiet", "--allow-empty", "-m", "base");
  const mergeBaseCommit = git(repoPath, "rev-parse", "HEAD");

  for (const file of testCase.files) {
    writeFile(repoPath, file.path, file.after);
  }
  git(repoPath, "add", "--all");
  git(repoPath, "commit", "--quiet", "--allow-empty", "-m", "synthetic PR");
  const headCommit = git(repoPath, "rev-parse", "HEAD");

  return {
    repoPath,
    runDirectory,
    mergeBaseCommit,
    headCommit,
    changes: testCase.files.map((file) => ({
      path: file.path,
      status: file.changeType,
      addedLines: file.after.split("\n").map((text, index) => ({
        line: index + 1,
        text,
      })),
    })),
  };
}

export function evaluateOcrOutput(
  testCase: GoldenTestCase,
  output: OcrReviewOutput,
): GoldenCaseRunResult {
  const findings = output.comments.map(toActualFinding);
  const evaluation = evaluateGoldenCase(testCase, findings);
  return {
    id: testCase.id,
    status: output.status,
    passed:
      output.complete &&
      output.status !== "skipped" &&
      evaluation.passed,
    findings,
    evaluation,
  };
}

export function toActualFinding(
  comment: Awaited<ReturnType<OpenCodeReviewRunner["review"]>>["comments"][number],
): GoldenActualFinding {
  const firstLine = comment.content.split("\n").find((line) => line.trim()) ?? "";
  return {
    filePath: comment.path,
    lineStart: comment.start_line > 0 ? comment.start_line : null,
    lineEnd: comment.end_line > 0 ? comment.end_line : null,
    category: comment.category ?? "other",
    severity: comment.severity ?? "low",
    title: firstLine.replace(/[*_`#]/g, "").trim(),
    description: comment.content,
    remediation: comment.suggestion_code ?? "",
  };
}

export function parseOptions(args: string[]): GoldenEvaluationOptions {
  const options: GoldenEvaluationOptions = {
    caseIds: new Set(),
    dryRun: false,
    judge: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--judge") options.judge = true;
    else if (argument === "--case") options.caseIds.add(requiredValue(args, ++index, argument));
    else if (argument === "--config") options.configPath = requiredValue(args, ++index, argument);
    else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

export async function judgeFindings(
  testCase: GoldenTestCase,
  result: GoldenCaseRunResult,
  judge: EvaluationJudge,
): Promise<Array<{ findingIndex: number; judgement: QualitativeJudgement }>> {
  const unexpected = new Set(result.evaluation.unexpectedFindingIndexes);
  const code = testCase.files
    .map((file) => `// ${file.path}\n${file.after}`)
    .join("\n\n");
  return Promise.all(result.findings.map(async (actualFinding, findingIndex) => ({
    findingIndex,
    judgement: await judge.evaluate({
      code,
      expectedFindings: testCase.expectedFindings,
      actualFinding,
      matchedExpectation: !unexpected.has(findingIndex),
    }),
  })));
}

function requiredValue(args: string[], index: number, option: string): string {
  const value = args[index];
  if (!value) throw new Error(`${option} requires a value`);
  return value;
}

function writeFile(root: string, relativePath: string, contents: string): void {
  const destination = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents);
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
