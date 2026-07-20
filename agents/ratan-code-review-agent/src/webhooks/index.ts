import express from "express";
import crypto from "node:crypto";

// ─── Duplicate Detection ───────────────────────────────────────────────────

const recentReviews = new Map<string, number>();
const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function isDuplicate(prId: number, commitSha?: string): boolean {
  const key = `${prId}:${commitSha ?? "unknown"}`;
  const lastProcessed = recentReviews.get(key);
  const now = Date.now();

  if (lastProcessed && now - lastProcessed < DEDUP_WINDOW_MS) {
    return true;
  }

  recentReviews.set(key, now);

  // Periodically clean up old entries when map grows large
  if (recentReviews.size > 100) {
    for (const [k, t] of recentReviews) {
      if (now - t > DEDUP_WINDOW_MS) {
        recentReviews.delete(k);
      }
    }
  }

  return false;
}

// ─── Server ────────────────────────────────────────────────────────────────

export function createWebhookServer(options: {
  port: number;
  secret?: string;
  onPREvent: (event: { action: string; prId: number; repository: string }) => Promise<void>;
}): express.Express {
  const app = express();

  // Raw body for HMAC validation
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as any).rawBody = buf;
      },
    }),
  );

  // POST /webhooks/ado
  app.post("/webhooks/ado", async (req, res) => {
    // 1. Validate HMAC signature if secret configured
    if (options.secret) {
      const signature = req.headers["x-hub-signature"] as string;
      if (!signature || !validateHmac(req, options.secret, signature)) {
        return res.status(401).json({ error: "Invalid signature" });
      }
    }

    // 2. Extract event details
    const eventType = req.headers["x-hub-event"] as string;
    const body = req.body;

    // Handle pullrequest.created and pullrequest.updated
    if (eventType?.startsWith("git.pullrequest")) {
      const resource = body?.resource;
      const prId = resource?.pullRequestId;
      const repository = resource?.repository?.name;
      const commitSha =
        resource?.lastMergeSourceCommit?.commitId ??
        resource?.lastMergeTargetCommit?.commitId;

      if (!prId || !repository) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // 3. Duplicate detection
      if (isDuplicate(prId, commitSha)) {
        console.log(`[webhook] Skipping duplicate event for PR #${prId}`);
        return res.status(200).json({ status: "skipped", reason: "duplicate" });
      }

      // Fire and forget — don't wait for review
      options.onPREvent({ action: eventType, prId, repository }).catch((err) => {
        console.error("Webhook handler error:", err);
      });

      return res.status(200).json({ accepted: true });
    }

    res.status(200).json({ ignored: true });
  });

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  return app;
}

function validateHmac(req: express.Request, secret: string, signature: string): boolean {
  const rawBody = (req as any).rawBody;
  if (!rawBody) return false;
  const hmac = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
}
