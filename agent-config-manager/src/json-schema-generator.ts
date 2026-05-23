import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import z from "zod";
import { RootAgentConfigSchema } from "./types";

// Define __filename and __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fullAgentConfigJsonSchema = z.toJSONSchema(RootAgentConfigSchema);

const outputPath = resolve(__dirname, "full-agent-config.schema.json");
writeFileSync(
  outputPath,
  JSON.stringify(fullAgentConfigJsonSchema, null, 2),
  "utf-8",
);
console.log(`JSON schema written to ${outputPath}`);
