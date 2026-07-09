import { createStep } from "@mastra/core/workflows";
import z from "zod";
import { extractAgentConfig } from "../../../bootstrap/session";
import { type CommonRequestContext, PullRequestSchema } from "../../types";
import { type NormalizedFinding, NormalizedFindingSchema } from "../../types/finding";
import { AIReviewScanner } from "./ai-review-scanner";
import { CveScanner } from "./cve-scanner";
import { complianceEngine } from "./compliance-engine";
import type { FindingStore } from "finding-store";
import type { Scanner } from "./types";
import { reconcileFindings } from "../utils/finding-reconciler";

// ─── Input/Output Schemas ─────────────────────────────────────────────────────

const ScannerPipelineInputSchema = z.object({
  prDetails: PullRequestSchema,
  workItemContext: z.string().optional(),
});

const ScannerPipelineOutputSchema = z.object({
  prDetails: PullRequestSchema,
  workItemContext: z.string().optional(),
  findings: z.array(NormalizedFindingSchema),
  correlationSummary: z.string(),
  changesSinceLastReview: z.string().optional(),
});

// ─── Severity Priority Map ────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  informational: 4,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Deduplicate findings by contentHash.
 * When the same hash appears from multiple engines, keep the one with the
 * higher severity (lower order number) and merge evidence strings.
 */
function correlateFindings(findings: NormalizedFinding[]): NormalizedFinding[] {
  const map = new Map<string, NormalizedFinding>();

  for (const f of findings) {
    const existing = map.get(f.contentHash);
    if (!existing) {
      map.set(f.contentHash, f);
      continue;
    }

    const existingRank = SEVERITY_ORDER[existing.severity] ?? 99;
    const currentRank = SEVERITY_ORDER[f.severity] ?? 99;

    if (currentRank < existingRank) {
      // Current finding has higher severity — replace, but merge evidence
      f.evidence = [existing.evidence, f.evidence]
        .filter(Boolean)
        .join("\n---\n");
      map.set(f.contentHash, f);
    } else {
      // Keep the existing one, merge current evidence into it
      existing.evidence = [existing.evidence, f.evidence]
        .filter(Boolean)
        .join("\n---\n");
    }
  }

  return Array.from(map.values());
}

/**
 * Sort findings by severity (critical first), then by confidence (highest first).
 * Returns at most MAX_FINDINGS results.
 */
function prioritizeFindings(findings: NormalizedFinding[]): NormalizedFinding[] {
  const MAX_FINDINGS = 100;

  return findings
    .sort((a, b) => {
      const sevDiff = (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99);
      if (sevDiff !== 0) return sevDiff;
      return b.confidence - a.confidence;
    })
    .slice(0, MAX_FINDINGS);
}

/**
 * Count findings at each severity level for the summary.
 */
function severityCounts(findings: NormalizedFinding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of findings) {
    const sev = f.severity || "unknown";
    counts[sev] = (counts[sev] ?? 0) + 1;
  }
  return counts;
}

// ─── Step ─────────────────────────────────────────────────────────────────────

export const scannerPipeline = createStep({
  id: "scanner-pipeline",
  description: "Run all configured scanners in parallel and correlate results",
  inputSchema: ScannerPipelineInputSchema,
  outputSchema: ScannerPipelineOutputSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    if (!inputData) {
      throw new Error("Input data not found");
    }

    const { prDetails, workItemContext } = inputData;

    const agentConfig = extractAgentConfig(
      requestContext as unknown as CommonRequestContext,
    );

    const adoClient = agentConfig.getAdoClient();
    const rootConfig = await agentConfig.getRootConfig();

    // ── Initialise FindingStore ─────────────────────────────────────────
    const findingStore: FindingStore = new (await import("finding-store")).FindingStore();
    const findingStorePath = rootConfig.findingStorePath ?? ".ratan/data/findings.db";
    findingStore.init(findingStorePath);

    // ── Build scanner list ──────────────────────────────────────────────
    const scanners: Scanner[] = [];

    scanners.push(new AIReviewScanner());

    const scannerSettings = rootConfig.scannerSettings ?? {};
    if (scannerSettings.cve?.enabled !== false) {
      scanners.push(new CveScanner());
    }
    if (scannerSettings.compliance?.enabled === true) {
      scanners.push(complianceEngine);
    }

    // ── Run all scanners in parallel ────────────────────────────────────
    const scanContext = {
      provider: agentConfig,
      adoClient,
      sonarClient: agentConfig.getSonarQubeClient(),
      findingStore,
      mastra,
      workItemContext,
    };

    const results = await Promise.allSettled(
      scanners.map((scanner) =>
        scanner.scan(prDetails, scanContext).then((r) => ({
          findings: r.findings,
          engine: r.engine,
          durationMs: r.durationMs,
        })),
      ),
    );

    // ── Collect results ─────────────────────────────────────────────────
    const allFindings: NormalizedFinding[] = [];

    for (const result of results) {
      if (result.status === "fulfilled") {
        allFindings.push(...(result.value.findings as NormalizedFinding[]));
      } else {
        console.warn(
          `[scanner-pipeline] Scanner failed: ${(result.reason as Error).message}`,
        );
      }
    }

    // ── Correlate & prioritise ──────────────────────────────────────────
    const correlated = correlateFindings(allFindings);
    const prioritized = prioritizeFindings(correlated);

    let changesSinceLastReview = "";
    try {
      const previousFindings = findingStore.getFindingsByPr(
        prDetails.pullRequestId,
        prDetails.repoName,
      ) as unknown as NormalizedFinding[];
      if (previousFindings.length > 0 && prioritized.length > 0) {
        const reconciled = reconcileFindings(previousFindings, prioritized);
        const parts: string[] = ["#### Changes since last review\n"];
        if (reconciled.findingsToResolve.length > 0) {
          parts.push(`**${reconciled.findingsToResolve.length}** findings resolved`);
        }
        if (reconciled.findingsToSupersede.length > 0) {
          parts.push(`**${reconciled.findingsToSupersede.length}** findings updated`);
        }
        if (reconciled.findingsToCreate.length > 0) {
          parts.push(`**${reconciled.findingsToCreate.length}** new findings`);
        }
        if (parts.length > 1) {
          changesSinceLastReview = parts.join("\n- ") + "\n\n";
        }
      }
    } catch {
      changesSinceLastReview = "";
    }

    // ── Persist ─────────────────────────────────────────────────────────
    try {
      findingStore.batchUpsert(prioritized as Parameters<typeof findingStore.batchUpsert>[0]);
    } catch (err) {
      console.error("[scanner-pipeline] Failed to persist findings:", err);
      // Non-fatal — return findings regardless
    }

    // ── Generate summary ────────────────────────────────────────────────
    const counts = severityCounts(prioritized);
    const summaryParts: string[] = [];
    const total = prioritized.length;
    const scannerCount = results.filter((r) => r.status === "fulfilled").length;

    summaryParts.push(`Found ${total} issues across ${scannerCount} scanner(s)`);

    const sevLabels: Record<string, string> = {
      critical: "critical",
      high: "high",
      medium: "medium",
      low: "low",
      informational: "informational",
    };

    const severitySegments: string[] = [];
    for (const label of ["critical", "high", "medium", "low", "informational"]) {
      const n = counts[label] ?? 0;
      if (n > 0) {
        severitySegments.push(`${n} ${sevLabels[label]}`);
      }
    }

    if (severitySegments.length > 0) {
      summaryParts.push(`(${severitySegments.join(", ")})`);
    }

    const correlationSummary = summaryParts.join(" ");

    return {
      prDetails,
      workItemContext,
      findings: prioritized,
      correlationSummary,
      changesSinceLastReview,
    };
  },
});
