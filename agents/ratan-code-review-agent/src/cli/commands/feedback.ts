import { Command } from "commander";
import { FindingStore } from "finding-store";
import { FeedbackService } from "../../mastra/workflows/services/feedback-service";

export function feedbackCommand(program: Command) {
  const feedbackCmd = program.command("feedback")
    .description("Manage feedback on findings");

  feedbackCmd.command("stats")
    .description("Show feedback statistics")
    .option("--finding-store <path>", "Path to finding store database")
    .action(async (options) => {
      const store = new FindingStore(options.findingStore);
      store.init();
      const service = new FeedbackService(store);
      const stats = await service.getFeedbackStats();
      console.log("Feedback Statistics:");
      for (const [engine, data] of Object.entries(stats.perEngine)) {
        console.log(`  ${engine}: ${data.total} total, ${data.falsePositive} FP (${(data.fpRate * 100).toFixed(1)}%)`);
      }
      if (stats.highFpRules.length > 0) {
        console.log("\nHigh FP Rate Rules:");
        stats.highFpRules.forEach(r => console.log(`  ⚠ ${r}`));
      }
      store.close();
    });

  feedbackCmd.command("export")
    .description("Export feedback data")
    .option("--format <format>", "Output format (json|csv)", "json")
    .option("--finding-store <path>", "Path to finding store database")
    .action(async (options) => {
      const store = new FindingStore(options.findingStore);
      store.init();
      const service = new FeedbackService(store);
      const data = await service.exportFeedback(options.format);
      console.log(data);
      store.close();
    });
}
