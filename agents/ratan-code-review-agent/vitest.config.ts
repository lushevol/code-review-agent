import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "finding-store": fileURLToPath(
        new URL("../../packages/finding-store/src/index.ts", import.meta.url),
      ),
      "agent-config-manager": fileURLToPath(
        new URL("../../packages/agent-config-manager/src/index.ts", import.meta.url),
      ),
      "ratan-ado-api": fileURLToPath(
        new URL("../../packages/ratan-ado-api/src/index.ts", import.meta.url),
      ),
      "ratan-sonarqube-api": fileURLToPath(
        new URL("../../packages/ratan-sonarqube-api/src/index.ts", import.meta.url),
      ),
    },
  },
  // Configure Vitest (https://vitest.dev/config/)
  test: {},
});
