import express from "express";
import cors from "cors";
import type { FindingStore } from "finding-store";

export function createDashboardApp(findingStore: FindingStore) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // GET /api/health
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // GET /api/findings - query findings
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

      // Return recent if no specific PR
      // This is simplified - would need pagination in production
      return res.json({ findings: [], total: 0 });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  // PATCH /api/findings/:id - override finding resolution
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

  // GET /api/audit
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

  // GET /api/stats - aggregated metrics
  app.get("/api/stats", (_req, res) => {
    try {
      // Simple stats from FindingStore
      // In production, this would use the ORM's getCodeReviewAgentStatistics()
      return res.json({
        message: "Stats endpoint - use with ORM integration",
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  return app;
}
