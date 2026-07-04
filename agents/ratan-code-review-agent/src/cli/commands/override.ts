import { Command } from "commander";
import { FindingStore } from "finding-store";
import { OverrideService } from "../../mastra/workflows/services/override-service";

export function overrideCommand(program: Command) {
  const overrideCmd = program.command("override")
    .description("Manage finding overrides");

  overrideCmd.command("list")
    .description("List active overrides")
    .option("--pr-id <number>", "Filter by PR ID")
    .option("--finding-store <path>", "Path to finding store database")
    .action(async (options) => {
      const store = new FindingStore(options.findingStore);
      store.init();
      const service = new OverrideService(store);
      // List expired overrides
      const expired = await service.getExpiredOverrides();
      console.log(`Expired overrides: ${expired.length}`);
      // In production, list active overrides from the store
      store.close();
    });

  overrideCmd.command("create")
    .description("Create an override for a finding")
    .requiredOption("--finding-id <id>", "Finding ID to override")
    .requiredOption("--resolution <type>", "New resolution (waived|false-positive|accepted-risk)")
    .requiredOption("--by <user>", "User creating the override")
    .option("--justification <text>", "Reason for override")
    .option("--expiry <date>", "Expiry date (ISO) for waived/accepted-risk")
    .option("--finding-store <path>", "Path to finding store database")
    .action(async (options) => {
      const store = new FindingStore(options.findingStore);
      store.init();
      store.updateResolution(options.findingId, options.resolution, {
        overriddenBy: options.by,
        justification: options.justification,
        expiryDate: options.expiry,
      });
      console.log(`Override created for finding ${options.findingId}`);
      store.close();
    });

  overrideCmd.command("revoke")
    .description("Revoke an override")
    .requiredOption("--finding-id <id>", "Finding ID")
    .requiredOption("--by <user>", "User revoking the override")
    .option("--finding-store <path>", "Path to finding store database")
    .action(async (options) => {
      const store = new FindingStore(options.findingStore);
      store.init();
      store.updateResolution(options.findingId, "open", {
        overriddenBy: options.by,
        justification: "Override revoked",
      });
      console.log(`Override revoked for finding ${options.findingId}`);
      store.close();
    });
}
