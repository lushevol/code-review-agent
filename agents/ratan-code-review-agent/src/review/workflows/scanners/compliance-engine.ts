import { minimatch } from "minimatch";
import { promises as fs } from "node:fs";
import path from "node:path";
import { CodeChangeSchema } from "ratan-ado-api";
import type { z } from "zod";
import {
  type NormalizedFinding,
  type EngineType,
  computeContentHash,
  generateFindingId,
} from "../../types/finding";
import type { Scanner, ScanContext } from "./types";

type CodeChange = z.infer<typeof CodeChangeSchema>;

// ─── Constants ─────────────────────────────────────────────────────────────

const SOURCE_VERSION = "2.0.0";
const LARGE_FILE_THRESHOLD = 400;

const TODO_PATTERNS = [
  /\bTODO\b/,
  /\bFIXME\b/,
  /\bHACK\b/,
  /\bXXX\b/,
] as const;

const CONSOLE_PATTERNS = [
  /console\.log\(/,
  /console\.error\(/,
] as const;

// Files matching these patterns are considered test files (skipped for console.log checks).
const TEST_FILE_PATTERNS = [
  "*.spec.*",
  "*.test.*",
  "*.test-utils.*",
  "**/__tests__/**",
  "**/test/**",
  "**/tests/**",
  "**/*.test/**",
] as const;

// ─── Rule File Types ──────────────────────────────────────────────────────

interface YamlRule {
  "rule-id": string;
  description: string;
  severity: string;
  forbidden_patterns: string[];
  file_patterns: string[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function isTestFile(filePath: string): boolean {
  return TEST_FILE_PATTERNS.some((pattern) => minimatch(filePath, pattern));
}

function isSourceFile(filePath: string): boolean {
  // Exclude common non-source directories and file types
  if (
    filePath.startsWith(".") ||
    filePath.includes("node_modules") ||
    filePath.includes("dist/") ||
    filePath.includes("build/") ||
    filePath.includes(".git/")
  ) {
    return false;
  }
  return true;
}

/**
 * Count total changed lines across all diff blocks in a file change entry.
 */
function countChangedLines(change: CodeChange): number {
  let total = 0;
  for (const block of change.blocks) {
    // Skip pure deletions
    if (block.changeType === 2) continue;
    total += block.mLines.length;
  }
  return total;
}

/**
 * Convert a severity string from YAML rules into a canonical severity value.
 * Falls back to "medium" if unrecognized.
 */
function normalizeSeverity(severity: string): NormalizedFinding["severity"] {
  const valid: NormalizedFinding["severity"][] = [
    "critical",
    "high",
    "medium",
    "low",
    "informational",
  ];
  const lower = severity.toLowerCase();
  if (valid.includes(lower as NormalizedFinding["severity"])) {
    return lower as NormalizedFinding["severity"];
  }
  return "medium";
}

// ─── Rule File Loading ────────────────────────────────────────────────────

let yamlModule: typeof import("yaml") | null | undefined;

async function getYamlModule(): Promise<typeof import("yaml") | null> {
  if (yamlModule !== undefined) return yamlModule;
  try {
    yamlModule = await import("yaml");
    return yamlModule;
  } catch {
    console.warn(
      "[compliance-engine] 'yaml' package not available. Skipping rule file loading.",
    );
    yamlModule = null;
    return null;
  }
}

async function loadRuleFiles(
  basePath: string,
): Promise<YamlRule[]> {
  const rulesDir = path.join(basePath, ".ratan", "code-review-agent", "rules");
  let entries: string[];
  try {
    entries = await fs.readdir(rulesDir);
  } catch {
    // Rules directory does not exist — this is expected
    return [];
  }

  const yaml = await getYamlModule();
  if (!yaml) return [];

  const rules: YamlRule[] = [];
  const yamlFiles = entries.filter(
    (e) => e.endsWith(".yaml") || e.endsWith(".yml"),
  );

  for (const file of yamlFiles) {
    const filePath = path.join(rulesDir, file);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const parsed = yaml.parse(content) as Record<string, unknown>;

      // Validate required fields
      if (
        typeof parsed["rule-id"] !== "string" ||
        typeof parsed.description !== "string" ||
        typeof parsed.severity !== "string" ||
        !Array.isArray(parsed.forbidden_patterns) ||
        !Array.isArray(parsed.file_patterns)
      ) {
        console.warn(
          `[compliance-engine] Skipping malformed rule file: ${file}`,
        );
        continue;
      }

      rules.push({
        "rule-id": parsed["rule-id"] as string,
        description: parsed.description as string,
        severity: parsed.severity as string,
        forbidden_patterns: parsed.forbidden_patterns as string[],
        file_patterns: parsed.file_patterns as string[],
      });
    } catch (err) {
      console.warn(
        `[compliance-engine] Failed to load rule file ${file}: ${(err as Error).message}`,
      );
    }
  }

  return rules;
}

// ─── Scanner Implementation ───────────────────────────────────────────────

export const complianceEngine: Scanner = {
  id: "compliance-engine",
  engine: "compliance" as EngineType,

  async scan(prDetails, context) {
    const startTime = performance.now();
    const findings: NormalizedFinding[] = [];
    const now = new Date().toISOString();

    const { codeDiffsArray = [] } = prDetails;

    if (codeDiffsArray.length === 0) {
      return {
        findings: [],
        engine: "compliance" as EngineType,
        durationMs: 0,
      };
    }

    // Load YAML rules from config base path (if available)
    let yamlRules: YamlRule[] = [];
    try {
      const rootConfig = await context.provider.getRootConfig();
      const basePath = rootConfig.scannerSettings?.compliance?.rulesPath ?? process.cwd();
      yamlRules = await loadRuleFiles(basePath);
    } catch {
      // Config reading is optional; proceed without rule files
    }

    for (const change of codeDiffsArray) {
      const targetFilePath = change.newFilePath || change.oldFilePath;

      // ── Built-in Check 1: TODO / FIXME / HACK / XXX ─────────────────
      for (const block of change.blocks) {
        // Only check blocks that contain added or modified lines
        if (block.changeType === 2) continue;

        const mLines = block.mLines ?? [];
        for (let i = 0; i < mLines.length; i++) {
          const line = mLines[i];
          const matchedPattern = TODO_PATTERNS.find((p) => p.test(line));
          if (!matchedPattern) continue;

          const lineNumber = block.mLine + i;
          const lineText = line.trim();
          const patternName = matchedPattern.source.replace(/\\b/g, "");

          findings.push({
            id: generateFindingId(),
            prId: prDetails.pullRequestId,
            repository: prDetails.repoName,
            filePath: targetFilePath ?? null,
            lineStart: lineNumber,
            lineEnd: lineNumber,
            category: "compliance",
            severity: "low",
            confidence: 1.0,
            title: `${patternName} found in ${targetFilePath ?? "unknown"}`,
            description: `The file contains a "${patternName}" marker at line ${lineNumber}.`,
            evidence: lineText,
            businessImpact:
              "Code markers like TODO and FIXME can indicate incomplete work or known issues that may be overlooked.",
            remediation:
              `Review the ${patternName} marker and either address the issue or remove the comment if no longer relevant.`,
            blocking: false,
            linkedTaskId: null,
            resolution: "open",
            sourceEngine: "compliance",
            sourceVersion: SOURCE_VERSION,
            supersedesFindingId: null,
            contentHash: computeContentHash(
              targetFilePath ?? "unknown",
              [lineText],
            ),
            createdAt: now,
            resolvedAt: null,
          });
        }
      }

      // ── Built-in Check 2: Large file warning ─────────────────────────
      const totalChanged = countChangedLines(change);
      if (totalChanged > LARGE_FILE_THRESHOLD) {
        findings.push({
          id: generateFindingId(),
          prId: prDetails.pullRequestId,
          repository: prDetails.repoName,
          filePath: targetFilePath ?? null,
          lineStart: null,
          lineEnd: null,
          category: "compliance",
          severity: "informational",
          confidence: 1.0,
          title: `Large file change in ${targetFilePath ?? "unknown"}`,
          description: `This file has ${totalChanged} changed lines, exceeding the ${LARGE_FILE_THRESHOLD}-line threshold.`,
          evidence: `${totalChanged} lines changed`,
          businessImpact:
            "Large diffs are harder to review thoroughly and may hide subtle issues.",
          remediation:
            `Consider splitting this change into smaller, focused pull requests.`,
          blocking: false,
          linkedTaskId: null,
          resolution: "open",
          sourceEngine: "compliance",
          sourceVersion: SOURCE_VERSION,
          supersedesFindingId: null,
          contentHash: computeContentHash(
            targetFilePath ?? "unknown",
            [`large-file:${totalChanged}`],
          ),
          createdAt: now,
          resolvedAt: null,
        });
      }

      // ── Built-in Check 3: console.log / console.error ────────────────
      if (
        targetFilePath &&
        isSourceFile(targetFilePath) &&
        !isTestFile(targetFilePath)
      ) {
        for (const block of change.blocks) {
          if (block.changeType === 2) continue;

          const mLines = block.mLines ?? [];
          for (let i = 0; i < mLines.length; i++) {
            const line = mLines[i];
            const matchedConsolePattern = CONSOLE_PATTERNS.find((p) =>
              p.test(line),
            );
            if (!matchedConsolePattern) continue;

            const lineNumber = block.mLine + i;
            const lineText = line.trim();

            findings.push({
              id: generateFindingId(),
              prId: prDetails.pullRequestId,
              repository: prDetails.repoName,
              filePath: targetFilePath,
              lineStart: lineNumber,
              lineEnd: lineNumber,
              category: "compliance",
              severity: "low",
              confidence: 1.0,
              title: `Console statement in source file`,
              description: `Source file ${targetFilePath} contains a console statement at line ${lineNumber}.`,
              evidence: lineText,
              businessImpact:
                "Console statements left in production code can cause performance overhead and clutter logs.",
              remediation:
                "Remove or replace the console statement with a proper logging framework.",
              blocking: false,
              linkedTaskId: null,
              resolution: "open",
              sourceEngine: "compliance",
              sourceVersion: SOURCE_VERSION,
              supersedesFindingId: null,
              contentHash: computeContentHash(targetFilePath, [lineText]),
              createdAt: now,
              resolvedAt: null,
            });
          }
        }
      }

      // ── YAML Rule Checks (optional) ──────────────────────────────────
      if (yamlRules.length > 0 && targetFilePath) {
        for (const rule of yamlRules) {
          const matchesFilePattern = rule.file_patterns.some((pattern) =>
            minimatch(targetFilePath, pattern),
          );
          if (!matchesFilePattern) continue;

          for (const block of change.blocks) {
            if (block.changeType === 2) continue;

            const mLines = block.mLines ?? [];
            for (let i = 0; i < mLines.length; i++) {
              const line = mLines[i];
              const matchedForbidden = rule.forbidden_patterns.find((p) =>
                line.toLowerCase().includes(p.toLowerCase()),
              );
              if (!matchedForbidden) continue;

              const lineNumber = block.mLine + i;
              const lineText = line.trim();

              findings.push({
                id: generateFindingId(),
                prId: prDetails.pullRequestId,
                repository: prDetails.repoName,
                filePath: targetFilePath,
                lineStart: lineNumber,
                lineEnd: lineNumber,
                category: "compliance",
                severity: normalizeSeverity(rule.severity),
                confidence: 1.0,
                title: `Compliance rule: ${rule["rule-id"]}`,
                description: rule.description,
                evidence: lineText,
                businessImpact:
                  "Violation of compliance rule may introduce security or policy risks.",
                remediation:
                  `Review the line and ensure it complies with the policy: ${rule.description}`,
                blocking: rule.severity === "high" || rule.severity === "critical",
                linkedTaskId: null,
                resolution: "open",
                sourceEngine: "compliance",
                sourceVersion: SOURCE_VERSION,
                supersedesFindingId: null,
                contentHash: computeContentHash(targetFilePath, [lineText]),
                createdAt: now,
                resolvedAt: null,
              });
            }
          }
        }
      }
    }

    const durationMs = Math.round(performance.now() - startTime);

    return {
      findings,
      engine: "compliance" as EngineType,
      durationMs,
    };
  },
};
