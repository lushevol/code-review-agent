import { createHash } from "node:crypto";
import { z } from "zod";

// ─── Enums ────────────────────────────────────────────────────────────────

export const FindingCategory = z.enum([
  "bug",
  "security",
  "compliance",
  "cve",
  "dependency",
  "quality",
]);
export type FindingCategory = z.infer<typeof FindingCategory>;

export const FindingSeverity = z.enum([
  "critical",
  "high",
  "medium",
  "low",
  "informational",
]);
export type FindingSeverity = z.infer<typeof FindingSeverity>;

export const FindingResolution = z.enum([
  "open",
  "resolved",
  "superseded",
  "waived",
  "false-positive",
  "accepted-risk",
]);
export type FindingResolution = z.infer<typeof FindingResolution>;

export const EngineType = z.enum([
  "ai-review",
  "sonarqube-cve",
  "compliance",
]);
export type EngineType = z.infer<typeof EngineType>;

// ─── Main Finding Schema ──────────────────────────────────────────────────

export const NormalizedFindingSchema = z.object({
  id: z.string().uuid(),
  prId: z.number(),
  repository: z.string(),
  filePath: z.string().nullable(),
  lineStart: z.number().int().nullable(),
  lineEnd: z.number().int().nullable(),
  category: FindingCategory,
  severity: FindingSeverity,
  confidence: z.number().min(0).max(1),
  title: z.string().min(1),
  description: z.string(),
  evidence: z.string(),
  businessImpact: z.string(),
  remediation: z.string(),
  blocking: z.boolean(),
  linkedTaskId: z.number().int().nullable(),
  resolution: FindingResolution,
  sourceEngine: EngineType,
  sourceVersion: z.string(),
  supersedesFindingId: z.string().uuid().nullable(),
  contentHash: z.string(),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
});

export type NormalizedFinding = z.infer<typeof NormalizedFindingSchema>;

// ─── Supporting Types ─────────────────────────────────────────────────────

export const ScannerResultSchema = z.object({
  findings: z.array(NormalizedFindingSchema),
  engine: EngineType,
  durationMs: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type ScannerResult = z.infer<typeof ScannerResultSchema>;

export const FindingFeedbackSchema = z.object({
  findingId: z.string().uuid(),
  feedbackType: z.enum([
    "true-positive",
    "false-positive",
    "lack-of-context",
    "by-design",
    "risk-accepted",
    "already-addressed",
  ]),
  userId: z.string(),
  comment: z.string().optional(),
  timestamp: z.string().datetime(),
});
export type FindingFeedback = z.infer<typeof FindingFeedbackSchema>;

export const AuditRecordSchema = z.object({
  id: z.string().uuid(),
  prId: z.number(),
  repository: z.string(),
  commitHash: z.string(),
  baseCommitHash: z.string().optional(),
  reviewStartTimestamp: z.string().datetime(),
  reviewEndTimestamp: z.string().datetime(),
  scanners: z.array(
    z.object({
      engine: EngineType,
      version: z.string(),
      durationMs: z.number(),
    }),
  ),
  modelVersion: z.string(),
  findingsCount: z.number(),
  blockingFindingsCount: z.number(),
  mergePolicyDecision: z.enum(["allowed", "blocked", "pending"]),
  supersedesReviewId: z.string().uuid().nullable(),
  rawScannerOutputs: z.record(z.string(), z.unknown()).optional(),
});
export type AuditRecord = z.infer<typeof AuditRecordSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Compute a content-addressable hash for a finding.
 * Uses SHA-256 of (filePath + normalized surrounding context).
 * This survives line-number shifts across commits because the
 * code content doesn't change when lines are added above.
 */
export function computeContentHash(
  filePath: string,
  surroundingLines: string[],
): string {
  const normalized = surroundingLines
    .map((l) => l.trimEnd())
    .join("\n");
  return createHash("sha256")
    .update(`${filePath}\0${normalized}`)
    .digest("hex");
}

/**
 * Generate a v4 UUID for finding IDs.
 */
export function generateFindingId(): string {
  return crypto.randomUUID();
}
