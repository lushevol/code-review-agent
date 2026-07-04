import { readFile } from "node:fs/promises";
import { loadConfig } from "../config/loader";
import { startReviewPrWithProvider, startScanWithProvider } from "../../bootstrap";

export interface ScanOptions {
  config?: string;
  watch?: boolean;
  mode?: "once" | "watch" | "service";
  prId?: number;
  feedbackDaemon?: boolean;
}

export async function scan(options: ScanOptions) {
  if (options.feedbackDaemon) {
    console.log("Feedback daemon mode — not yet implemented");
    return;
  }

  const { provider, configDir } = await loadConfig(options.config);
  await provider.connect();

  if (options.prId !== undefined) {
    await startReviewPrWithProvider(provider, options.prId);
    return;
  }

  const effectiveMode = options.mode ?? (options.watch ? "watch" : "once");

  if (effectiveMode === "service") {
    await runServiceMode(provider, configDir);
  } else if (effectiveMode === "watch") {
    await runWatchLoop(provider, options);
  } else {
    await startScanWithProvider(provider);
  }
}

async function runServiceMode(
  provider: import("agent-config-manager").ConfigProvider,
  configDir: string,
) {

  // Initialize finding store
  const { FindingStore } = await import("finding-store");
  const findingStore = new FindingStore();
  findingStore.init();

  // Create ADO client for webhook auto-registration
  let adoClient: any;
  try {
    const configContent = await readFile(configDir + "/config.json", "utf-8");
    const rawConfig = JSON.parse(configContent);

    function resolveEnvToken(value: string): string {
      const envMatch = value.match(/^env:(.+)$/);
      if (envMatch) {
        return process.env[envMatch[1]] || "";
      }
      return value;
    }

    if (rawConfig.ado?.organization && rawConfig.ado?.project) {
      const { AzureDevOps } = await import("ratan-ado-api");
      adoClient = new AzureDevOps({
        organization: rawConfig.ado.organization,
        project: rawConfig.ado.project,
      });
      const token = rawConfig.ado.token ? resolveEnvToken(rawConfig.ado.token) : "";
      await adoClient.connect(token);
    }
  } catch (err) {
    console.warn("Could not initialize ADO client for webhook registration:", err);
  }

  // Start webhook service
  const { startWebhookService } = await import("./webhook");
  const onReview = async (prId: number, _repository: string) => {
    try {
      await startReviewPrWithProvider(provider, prId);
    } catch (err) {
      console.error(`Review failed for PR ${prId}:`, err);
    }
  };

  await startWebhookService({
    adoClient,
    findingStore,
    port: Number(process.env.WEBHOOK_PORT) || 8080,
    secret: process.env.WEBHOOK_SECRET,
    onReview,
  });

  console.log("Webhook service running. Press Ctrl+C to stop.");

  // Keep running until SIGTERM
  await new Promise<void>((resolve) => {
    process.on("SIGTERM", () => {
      console.log("Shutting down webhook service...");
      findingStore.close();
      resolve();
    });
  });
}

async function runWatchLoop(
  provider: import("agent-config-manager").ConfigProvider,
  _options: ScanOptions,
) {
  const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

  const runOnce = async () => {
    // Re-register provider in case the session was cleared
    const { getAgentConfigSessions } = await import("../../bootstrap/session");
    getAgentConfigSessions().registerProvider(provider);

    await startScanWithProvider(provider);
  };

  // Run immediately, then every 30 min
  await runOnce();

  setInterval(async () => {
    console.log(`[watch] Scanning again (${INTERVAL_MS / 60000}min interval)...`);
    await runOnce();
  }, INTERVAL_MS);
}
