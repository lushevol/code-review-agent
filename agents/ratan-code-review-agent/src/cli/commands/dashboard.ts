import { FindingStore } from "finding-store";
import { createDashboardApp } from "../dashboard";

export interface DashboardOptions {
  port?: number;
  findingStorePath?: string;
}

export async function startDashboard(options: DashboardOptions) {
  const port = options.port ?? 3099;
  const dbPath = options.findingStorePath ?? ".ratan/code-review-agent/findings.db";

  // Initialize FindingStore
  const findingStore = new FindingStore(dbPath);
  try {
    findingStore.init();
    console.log(`FindingStore initialized at: ${dbPath}`);
  } catch (err) {
    console.error(`Warning: Could not open FindingStore at ${dbPath}:`, err);
    console.log("Starting dashboard without persistence — findings API will return empty.");
  }

  const app = createDashboardApp(findingStore);

  app.listen(port, () => {
    console.log(`PR Guardian Dashboard listening on http://localhost:${port}`);
    console.log(`  API: http://localhost:${port}/api/health`);
  });

  // Keep running until SIGTERM
  await new Promise<void>((resolve) => {
    process.on("SIGTERM", () => {
      console.log("Dashboard shutting down...");
      findingStore.close();
      resolve();
    });
  });
}
