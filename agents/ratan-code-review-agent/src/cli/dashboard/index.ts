import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import type { FindingEngine, FindingResolution, FindingStore } from "finding-store";
import { getPRQueue } from "../services/pr-queue";
import { getLogger } from "../utils/logger";

const FINDING_ENGINES = new Set<FindingEngine>([
  "ai-review",
  "open-code-review",
  "sonarqube-cve",
  "compliance",
]);
const FINDING_RESOLUTIONS = new Set<FindingResolution>([
  "open",
  "resolved",
  "superseded",
  "waived",
  "false-positive",
  "accepted-risk",
]);

/**
 * Resolve the dashboard SPA build directory. Works in both tsx (dev) and
 * compiled dist (published) contexts.
 */
function resolveDashboardDir(): string | null {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  for (const rel of ["../dashboard/dist", "../../dashboard/dist"]) {
    const candidate = path.resolve(dirname, rel);
    if (fs.existsSync(path.join(candidate, "index.html"))) return candidate;
  }
  return null;
}

export function createDashboardApp(findingStore: FindingStore): express.Express {
  const app = express();
  const logger = getLogger("dashboard");

  app.use(cors());
  app.use(express.json());

  // ── Dashboard SPA ─────────────────────────────────────────────────────
  const dashboardDist = resolveDashboardDir();
  if (dashboardDist) {
    app.use(express.static(dashboardDist));
  } else {
    logger.warn("Dashboard SPA not found — API-only mode");
  }

  // ── Health ────────────────────────────────────────────────────────────

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // ── Queue Status & Management ─────────────────────────────────────────

  /**
   * Get the current state of the PR review queue.
   */
  app.get("/api/queue", (_req, res) => {
    try {
      const queue = getPRQueue();
      res.json({
        currentProcessing: queue.currentProcessing,
        pendingCount: queue.pendingCount,
        pending: queue.getPending(),
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * Manually add a PR to the review queue.
   */
  app.post("/api/queue", (req, res) => {
    try {
      const { prId, repoName, repoId } = req.body;

      if (!prId || typeof prId !== "number") {
        return res.status(400).json({ error: "prId is required and must be a number" });
      }

      const queue = getPRQueue();
      queue.enqueue({
        prId,
        repoName: repoName ?? `PR #${prId}`,
        repoId: repoId ?? undefined,
      });

      logger.info(
        `Manual queue add: PR #${prId} (${repoName ?? "unknown repo"})`,
      );

      res.json({
        success: true,
        prId,
        pendingCount: queue.pendingCount,
        currentProcessing: queue.currentProcessing,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * Cancel processing of the current PR (if any).
   */
  app.post("/api/queue/cancel", (_req, res) => {
    try {
      const queue = getPRQueue();
      const cleared = queue.clearPending();
      res.json({
        success: true,
        cleared,
        message: "Queue cleared (current processing continues)",
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Findings ──────────────────────────────────────────────────────────

  app.get("/api/findings", (req, res) => {
    try {
      const prId = req.query.prId ? Number(req.query.prId) : undefined;
      const repo = req.query.repo as string | undefined;
      const engine = req.query.engine as string | undefined;
      const status = req.query.status as string | undefined;

      if (req.query.prId && (!Number.isInteger(prId) || (prId ?? 0) <= 0)) {
        return res.status(400).json({ error: "prId must be a positive integer" });
      }
      if (engine && !FINDING_ENGINES.has(engine as FindingEngine)) {
        return res.status(400).json({ error: "engine is invalid" });
      }
      if (status && !FINDING_RESOLUTIONS.has(status as FindingResolution)) {
        return res.status(400).json({ error: "status is invalid" });
      }
      const findings = findingStore.queryFindings({
        prId,
        repository: repo,
        engine: engine as FindingEngine | undefined,
        resolution: status as FindingResolution | undefined,
      });
      return res.json({ findings, total: findings.length });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/overrides", (req, res) => {
    try {
      const findingId = req.query.findingId as string | undefined;
      const overrides = findingStore.queryOverrideLog(findingId);
      return res.json({ overrides, total: overrides.length });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  app.patch("/api/findings/:id", (req, res) => {
    try {
      const { id } = req.params;
      const { resolution, justification, overriddenBy, expiryDate } = req.body;

      if (!resolution || !overriddenBy) {
        return res.status(400).json({ error: "resolution and overriddenBy required" });
      }
      if (!FINDING_RESOLUTIONS.has(resolution as FindingResolution)) {
        return res.status(400).json({ error: "resolution is invalid" });
      }

      findingStore.updateResolution(id, resolution as FindingResolution, {
        overriddenBy,
        justification,
        expiryDate,
      });

      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  // ── Audit ─────────────────────────────────────────────────────────────

  app.get("/api/audit", (req, res) => {
    try {
      const prId = req.query.prId ? Number(req.query.prId) : undefined;
      const repo = req.query.repo as string | undefined;
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;

      const records = findingStore.queryAuditRecords({ prId, repository: repo, from, to });
      return res.json({ records });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  // ── Stats ─────────────────────────────────────────────────────────────

  app.get("/api/stats", (_req, res) => {
    try {
      const auditRecords = findingStore.queryAuditRecords({});
      const uniquePrs = new Set(
        auditRecords.map((record) => `${record.repository}:${record.prId}`),
      );
      const allFindings = findingStore.queryFindings({});

      const severityCounts: Record<string, number> = {};
      const engineCounts: Record<string, number> = {};
      let totalBlocking = 0;
      let totalResolved = 0;

      for (const f of allFindings) {
        const sev = f.severity || "unknown";
        severityCounts[sev] = (severityCounts[sev] ?? 0) + 1;

        const eng = f.sourceEngine || "unknown";
        engineCounts[eng] = (engineCounts[eng] ?? 0) + 1;

        if (f.blocking && f.resolution === "open") totalBlocking++;
        if (f.resolution && f.resolution !== "open") totalResolved++;
      }

      const recentActivity = [...auditRecords]
        .sort((a, b) => b.reviewStartTimestamp.localeCompare(a.reviewStartTimestamp))
        .slice(0, 10)
        .map((record) => ({
          action: record.mergePolicyDecision === "blocked" ? "Review blocked" : "Review completed",
          detail: `${record.repository} PR #${record.prId}: ${record.findingsCount} findings`,
          timestamp: record.reviewEndTimestamp,
        }));

      return res.json({
        totalReviews: auditRecords.length,
        totalPRs: uniquePrs.size,
        totalFindings: allFindings.length,
        blockingFindings: totalBlocking,
        resolvedFindings: totalResolved,
        severityCounts,
        engineCounts,
        recentActivity,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  // ── PRs ───────────────────────────────────────────────────────────────

  app.get("/api/prs", (req, res) => {
    try {
      const repo = req.query.repo as string | undefined;
      const status = req.query.status as string | undefined;

      const auditRecords = findingStore.queryAuditRecords({ repository: repo });

      const prMap = new Map<string, {
        prId: number;
        repository: string;
        status: string;
        findingCount: number;
        blockingCount: number;
        createdAt: string;
      }>();

      for (const record of [...auditRecords].sort(
        (a, b) => b.reviewStartTimestamp.localeCompare(a.reviewStartTimestamp),
      )) {
        const key = `${record.repository}:${record.prId}`;
        if (!prMap.has(key)) {
          const findings = findingStore.queryFindings({
            prId: record.prId,
            repository: record.repository,
          });
          prMap.set(key, {
            prId: record.prId,
            repository: record.repository,
            status: record.mergePolicyDecision,
            findingCount: findings.length,
            blockingCount: findings.filter(
              (finding) => finding.blocking && finding.resolution === "open",
            ).length,
            createdAt: record.reviewStartTimestamp,
          });
        }
      }

      const prs = Array.from(prMap.values()).filter(
        (pr) => !status || pr.status === status,
      );

      return res.json({
        prs,
        total: prs.length,
      });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  // ── SPA fallback — all non-API routes serve index.html for client-side routing ─

  if (dashboardDist) {
    app.get("*", (_req, res) => {
      res.sendFile(path.join(dashboardDist, "index.html"));
    });
  }

  return app;
}
