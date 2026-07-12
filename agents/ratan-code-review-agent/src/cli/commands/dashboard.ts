import { FindingStore } from "finding-store";
import { createDashboardApp } from "../dashboard";
import { getLogger } from "../utils/logger";

export interface DashboardOptions {
  port?: number;
  findingStorePath?: string;
}

export async function startDashboard(options: DashboardOptions) {
  const logger = getLogger("dashboard");
  const port = options.port ?? 3099;
  const dbPath = options.findingStorePath ?? ".ratan/data/findings.db";

  // Initialize FindingStore
  const findingStore = new FindingStore(dbPath);
  try {
    findingStore.init();
    logger.info(`FindingStore initialized at: ${dbPath}`);
  } catch (err) {
    logger.error(`Could not open FindingStore at ${dbPath}`, err);
    logger.warn("Starting dashboard without persistence — findings API will return empty.");
  }

  const app = createDashboardApp(findingStore);

  app.listen(port, () => {
    logger.info(`PR Guardian Dashboard listening on http://localhost:${port}`);
    logger.info(`API: http://localhost:${port}/api/health`);
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
