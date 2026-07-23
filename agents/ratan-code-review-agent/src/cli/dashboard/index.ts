import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
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
  for (const rel of [
    // tsx source: src/cli/dashboard/ -> ../../../dashboard/dist
    "../../../dashboard/dist",
    // compiled dist: dist/cli/dashboard/ -> ../dashboard/dist
    "../dashboard/dist",
    // compiled dist (alternate): dist/cli/dashboard/ -> ../../dashboard/dist
    "../../dashboard/dist",
  ]) {
    const candidate = path.resolve(dirname, rel);
    if (fs.existsSync(path.join(candidate, "index.html"))) return candidate;
  }
  return null;
}

export function createDashboardApp(findingStore: FindingStore): Hono {
  const app = new Hono();
  const logger = getLogger("dashboard");

  app.use("/api/*", cors());

  // ── Dashboard SPA ─────────────────────────────────────────────────────
  const dashboardDist = resolveDashboardDir();
  if (!dashboardDist) {
    logger.warn("Dashboard SPA not found — API-only mode");
  }

  // ── Health ────────────────────────────────────────────────────────────

  app.get("/api/health", (c) => {
    return c.json({ status: "ok" });
  });

  // ── Queue Status & Management ─────────────────────────────────────────

  /**
   * Get the current state of the PR review queue.
   */
  app.get("/api/queue", (c) => {
    try {
      const queue = getPRQueue();
      return c.json({
        currentProcessing: queue.currentProcessing,
        pendingCount: queue.pendingCount,
        pending: queue.getPending(),
      });
    } catch (err) {
      c.status(500);
      return c.json({ error: String(err) });
    }
  });

  /**
   * Manually add a PR to the review queue.
   */
  app.post("/api/queue", async (c) => {
    try {
      const body = await c.req.json();
      const { prId, repoName, repoId } = body;

      if (!prId || typeof prId !== "number") {
        c.status(400);
        return c.json({ error: "prId is required and must be a number" });
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

      return c.json({
        success: true,
        prId,
        pendingCount: queue.pendingCount,
        currentProcessing: queue.currentProcessing,
      });
    } catch (err) {
      c.status(500);
      return c.json({ error: String(err) });
    }
  });

  /**
   * Cancel processing of the current PR (if any).
   */
  app.post("/api/queue/cancel", (c) => {
    try {
      const queue = getPRQueue();
      const cleared = queue.clearPending();
      return c.json({
        success: true,
        cleared,
        message: "Queue cleared (current processing continues)",
      });
    } catch (err) {
      c.status(500);
      return c.json({ error: String(err) });
    }
  });

  // ── Findings ──────────────────────────────────────────────────────────

  app.get("/api/findings", (c) => {
    try {
      const prId = c.req.query("prId") ? Number(c.req.query("prId")) : undefined;
      const repo = c.req.query("repo") ?? undefined;
      const engine = c.req.query("engine") ?? undefined;
      const status = c.req.query("status") ?? undefined;

      if (c.req.query("prId") && (!Number.isInteger(prId) || (prId ?? 0) <= 0)) {
        c.status(400);
        return c.json({ error: "prId must be a positive integer" });
      }
      if (engine && !FINDING_ENGINES.has(engine as FindingEngine)) {
        c.status(400);
        return c.json({ error: "engine is invalid" });
      }
      if (status && !FINDING_RESOLUTIONS.has(status as FindingResolution)) {
        c.status(400);
        return c.json({ error: "status is invalid" });
      }
      const findings = findingStore.queryFindings({
        prId,
        repository: repo,
        engine: engine as FindingEngine | undefined,
        resolution: status as FindingResolution | undefined,
      });
      return c.json({ findings, total: findings.length });
    } catch (err) {
      c.status(500);
      return c.json({ error: String(err) });
    }
  });

  app.get("/api/overrides", (c) => {
    try {
      const findingId = c.req.query("findingId") ?? undefined;
      const overrides = findingStore.queryOverrideLog(findingId);
      return c.json({ overrides, total: overrides.length });
    } catch (err) {
      c.status(500);
      return c.json({ error: String(err) });
    }
  });

  app.patch("/api/findings/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const body = await c.req.json();
      const { resolution, justification, overriddenBy, expiryDate } = body;

      if (!resolution || !overriddenBy) {
        c.status(400);
        return c.json({ error: "resolution and overriddenBy required" });
      }
      if (!FINDING_RESOLUTIONS.has(resolution as FindingResolution)) {
        c.status(400);
        return c.json({ error: "resolution is invalid" });
      }

      findingStore.updateResolution(id, resolution as FindingResolution, {
        overriddenBy,
        justification,
        expiryDate,
      });

      return c.json({ success: true });
    } catch (err) {
      c.status(500);
      return c.json({ error: String(err) });
    }
  });

  // ── Audit ─────────────────────────────────────────────────────────────

  app.get("/api/audit", (c) => {
    try {
      const prId = c.req.query("prId") ? Number(c.req.query("prId")) : undefined;
      const repo = c.req.query("repo") ?? undefined;
      const from = c.req.query("from") ?? undefined;
      const to = c.req.query("to") ?? undefined;

      const records = findingStore.queryAuditRecords({ prId, repository: repo, from, to });
      return c.json({ records });
    } catch (err) {
      c.status(500);
      return c.json({ error: String(err) });
    }
  });

  // ── Stats ─────────────────────────────────────────────────────────────

  app.get("/api/stats", (c) => {
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

      return c.json({
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
      c.status(500);
      return c.json({ error: String(err) });
    }
  });

  // ── PRs ───────────────────────────────────────────────────────────────

  app.get("/api/prs", (c) => {
    try {
      const repo = c.req.query("repo") ?? undefined;
      const status = c.req.query("status") ?? undefined;

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

      return c.json({
        prs,
        total: prs.length,
      });
    } catch (err) {
      c.status(500);
      return c.json({ error: String(err) });
    }
  });

  // ── Review Performance Metrics ──────────────────────────────────────────

  app.get("/api/metrics", (c) => {
    try {
      const prId = c.req.query("prId") ? Number(c.req.query("prId")) : undefined;

      if (prId !== undefined) {
        if (!Number.isInteger(prId) || prId <= 0) {
          c.status(400);
          return c.json({ error: "prId must be a positive integer" });
        }
        const repo = c.req.query("repo");
        if (!repo) {
          c.status(400);
          return c.json({ error: "repo is required when prId is specified" });
        }
        const perReview = findingStore.queryMetrics(prId, repo);
        return c.json({ perReview, total: perReview.length });
      }

      const aggregate = findingStore.queryAggregatedMetrics();
      return c.json({ aggregate });
    } catch (err) {
      c.status(500);
      return c.json({ error: String(err) });
    }
  });

  // ── SPA fallback — all non-API routes serve index.html for client-side routing ─

  if (dashboardDist) {
    app.get("*", (c) => {
      const filePath = path.join(dashboardDist, c.req.path);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        const mime: Record<string, string> = {
          ".js": "application/javascript",
          ".css": "text/css",
          ".html": "text/html",
          ".png": "image/png",
          ".svg": "image/svg+xml",
          ".ico": "image/x-icon",
          ".json": "application/json",
          ".woff2": "font/woff2",
        };
        return c.body(fs.readFileSync(filePath), 200, {
          "Content-Type": mime[ext] ?? "application/octet-stream",
        });
      }
      // SPA fallback
      const indexPath = path.join(dashboardDist, "index.html");
      if (fs.existsSync(indexPath)) {
        return c.html(fs.readFileSync(indexPath, "utf-8"));
      }
      return c.notFound();
    });
  }

  return app;
}
