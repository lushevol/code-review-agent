import { createWebhookServer } from "../../webhooks";
import type { FindingStore } from "finding-store";

export async function startWebhookService(options: {
  adoClient: any;
  findingStore: FindingStore;
  port: number;
  secret?: string;
  onReview: (prId: number, repo: string) => Promise<void>;
}) {
  // Start webhook server
  const app = createWebhookServer({
    port: options.port,
    secret: options.secret,
    onPREvent: async ({ prId, repository }) => {
      // Trigger review
      await options.onReview(prId, repository);
    },
  });

  app.listen(options.port, () => {
    console.log(`Webhook receiver listening on port ${options.port}`);
  });

  // Attempt auto-registration
  try {
    const baseUrl = process.env.WEBHOOK_PUBLIC_URL;
    if (baseUrl && options.adoClient?.createSubscription) {
      await options.adoClient.createSubscription(
        `${baseUrl}/webhooks/ado`,
        "git.pullrequest.created",
      );
      await options.adoClient.createSubscription(
        `${baseUrl}/webhooks/ado`,
        "git.pullrequest.updated",
      );
      console.log("Webhook subscriptions registered in ADO");
    }
  } catch (err) {
    console.warn("Webhook auto-registration failed, using polling fallback:", err);
  }
}
