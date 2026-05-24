import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import z from "zod";
import { codeChangesReviewTestCaseSchema } from "./type";

// Define __filename and __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const jsonSchema = z.toJSONSchema(codeChangesReviewTestCaseSchema);

const outputPath = resolve(
  __dirname,
  "code-change-review-test-case.schema.json",
);
writeFileSync(outputPath, JSON.stringify(jsonSchema, null, 2), "utf-8");
console.log(`JSON schema written to ${outputPath}`);
