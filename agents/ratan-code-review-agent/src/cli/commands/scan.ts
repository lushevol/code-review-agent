import { loadConfig } from "../config/loader";
import { startScanWithProvider } from "../../bootstrap";

export interface ScanOptions {
  config?: string;
  watch?: boolean;
}

export async function scan(options: ScanOptions) {
  const { provider } = await loadConfig(options.config);
  await provider.connect();

  if (options.watch) {
    await runWatchLoop(provider, options);
  } else {
    await startScanWithProvider(provider);
  }
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
