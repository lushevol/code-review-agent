import { Hono } from "hono";
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

// ─── HMAC Validation ───────────────────────────────────────────────────────

function validateHmac(rawBody: string, secret: string, signature: string): boolean {
  const hmac = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
}

// ─── Server ────────────────────────────────────────────────────────────────

export function createWebhookServer(options: {
  port: number;
  secret?: string;
  onPREvent: (event: { action: string; prId: number; repository: string }) => Promise<void>;
}): Hono {
  const app = new Hono();

  // POST /webhooks/ado
  app.post("/webhooks/ado", async (c) => {
    // 1. Read raw body for HMAC validation
    const rawBody = await c.req.raw.clone().text();
    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return c.text("Invalid JSON", 400);
    }

    // 2. Validate HMAC signature if secret configured
    if (options.secret) {
      const signature = c.req.header("x-hub-signature");
      if (!signature || !validateHmac(rawBody, options.secret, signature)) {
        return c.json({ error: "Invalid signature" }, 401);
      }
    }

    // 3. Extract event details
    const eventType = c.req.header("x-hub-event");

    // Handle pullrequest.created and pullrequest.updated
    if (eventType?.startsWith("git.pullrequest")) {
      const resource = body?.resource;
      const prId = resource?.pullRequestId;
      const repository = resource?.repository?.name;
      const commitSha =
        resource?.lastMergeSourceCommit?.commitId ??
        resource?.lastMergeTargetCommit?.commitId;

      if (!prId || !repository) {
        return c.json({ error: "Missing required fields" }, 400);
      }

      // 4. Duplicate detection
      if (isDuplicate(prId, commitSha)) {
        console.log(`[webhook] Skipping duplicate event for PR #${prId}`);
        return c.json({ status: "skipped", reason: "duplicate" }, 200);
      }

      // Fire and forget — don't wait for review
      options.onPREvent({ action: eventType, prId, repository }).catch((err) => {
        console.error("[webhook] Review handler failed", err);
      });

      return c.json({ accepted: true }, 200);
    }

    return c.json({ ignored: true }, 200);
  });

  // Health check
  app.get("/health", (c) => {
    return c.json({ status: "ok" });
  });

  return app;
}
