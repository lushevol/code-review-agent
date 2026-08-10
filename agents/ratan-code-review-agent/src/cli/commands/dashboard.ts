import { FindingStore } from "finding-store";
import { createDashboardApp } from "../dashboard";
import { serve } from "@hono/node-server";
import { getLogger } from "../utils/logger";
import { loadConfig } from "../config/loader";

export interface DashboardOptions {
  port?: number;
  findingStorePath?: string;
  config?: string;
}

export async function startDashboard(options: DashboardOptions) {
  const { provider } = await loadConfig(options.config);
  const rootConfig = await provider.getRootConfig();
  const logger = getLogger("dashboard");
  const port = options.port ?? rootConfig.dashboard?.port ?? 3099;
  const host = rootConfig.dashboard?.host ?? "127.0.0.1";
  const auth = rootConfig.dashboard?.auth;
  const dbPath = options.findingStorePath ?? rootConfig.findingStorePath ?? ".ratan/data/findings.db";

  if (!["127.0.0.1", "localhost", "::1"].includes(host) && !auth) {
    throw new Error(
      "Dashboard authentication is required when dashboard.host is not loopback",
    );
  }

  // Initialize FindingStore
  const findingStore = new FindingStore(dbPath);
  try {
    await findingStore.init();
    logger.info(`FindingStore initialized at: ${dbPath}`);
  } catch (err) {
    logger.error(`Could not open FindingStore at ${dbPath}`, err);
    logger.warn("Starting dashboard without persistence — findings API will return empty.");
  }

  const app = createDashboardApp(findingStore, { auth });

  serve({ fetch: app.fetch, hostname: host, port }, () => {
    logger.info(`PR Guardian Dashboard listening on http://${host}:${port}`);
    logger.info(`API: http://${host}:${port}/api/health`);
  });

  // Keep running until SIGTERM
  await new Promise<void>((resolve) => {
    process.on("SIGTERM", () => {
      logger.info("Dashboard shutting down...");
      findingStore.close();
      resolve();
    });
  });
}
