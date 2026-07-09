import express from "express";
import cors from "cors";
import type { FindingStore } from "finding-store";
import { getPRQueue } from "../services/pr-queue";
import { getLogger } from "../utils/logger";

export function createDashboardApp(findingStore: FindingStore) {
  const app = express();
  const logger = getLogger("dashboard");

  app.use(cors());
  app.use(express.json());

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

      if (prId && repo) {
        const findings = findingStore.getFindingsByPr(prId, repo);
        let filtered = findings;
        if (engine) filtered = filtered.filter(f => f.sourceEngine === engine);
        if (status) filtered = filtered.filter(f => f.resolution === status);
        return res.json({ findings: filtered, total: filtered.length });
      }

      return res.json({ findings: [], total: 0 });
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

      findingStore.updateResolution(id, resolution, {
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
      // Gather aggregated stats from FindingStore
      const auditRecords = findingStore.queryAuditRecords({});

      // Count unique PRs
      const uniquePrs = new Set(auditRecords.map((r) => r.prId));

      // Count findings by severity
      const allFindings = auditRecords.reduce((acc, record) => {
        // Pull findings per PR from the store
        const findings = findingStore.getFindingsByPr(record.prId, record.repository);
        return acc.concat(findings);
      }, [] as Array<{ severity: string; sourceEngine: string; resolution: string }>);

      const severityCounts: Record<string, number> = {};
      const engineCounts: Record<string, number> = {};
      let totalBlocking = 0;
      let totalResolved = 0;

      for (const f of allFindings) {
        const sev = f.severity || "unknown";
        severityCounts[sev] = (severityCounts[sev] ?? 0) + 1;

        const eng = f.sourceEngine || "unknown";
        engineCounts[eng] = (engineCounts[eng] ?? 0) + 1;

        if (sev === "critical" || sev === "high") totalBlocking++;
        if (f.resolution && f.resolution !== "open") totalResolved++;
      }

      return res.json({
        totalReviews: auditRecords.length,
        totalPRs: uniquePrs.size,
        totalFindings: allFindings.length,
        blockingFindings: totalBlocking,
        resolvedFindings: totalResolved,
        severityCounts,
        engineCounts,
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

      // Build unique PR list with aggregated data
      const prMap = new Map<number, {
        prId: number;
        repository: string;
        status: string;
        findingCount: number;
        blockingCount: number;
        createdAt: string;
      }>();

      for (const record of auditRecords) {
        if (status && record.mergePolicyDecision !== status) continue;

        const existing = prMap.get(record.prId);
        if (existing) {
          existing.findingCount += record.findingsCount ?? 0;
          existing.blockingCount += record.blockingFindingsCount ?? 0;
        } else {
          prMap.set(record.prId, {
            prId: record.prId,
            repository: record.repository,
            status: record.mergePolicyDecision,
            findingCount: record.findingsCount,
            blockingCount: record.blockingFindingsCount,
            createdAt: record.reviewStartTimestamp,
          });
        }
      }

      return res.json({
        prs: Array.from(prMap.values()),
        total: prMap.size,
      });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  return app;
}
