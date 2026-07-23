import fs from "node:fs";
import readline from "node:readline";
import { RootAgentConfigSchema } from "agent-config-manager";

// ─── Types ──────────────────────────────────────────────────────────────

export interface RepairResult {
  /** Whether the raw config object was modified (defaults filled in, etc.) */
  modified: boolean;
  /** Config after repair (may be a new object, may be the same reference) */
  config: Record<string, unknown>;
  /** Human-readable warnings */
  warnings: string[];
}

// ─── Known defaults ──────────────────────────────────────────────────────

const KNOWN_ROOT_KEYS = new Set<string>(
  Object.keys(
    (RootAgentConfigSchema as unknown as { shape: Record<string, unknown> }).shape,
  ),
);

// ─── Field-level repair ──────────────────────────────────────────────────

/**
 * Fill in sensible defaults for fields that previous configs may be missing.
 * These are fields that aren't strictly required by the Zod schema but that
 * the runtime depends on having a reasonable value.
 */
function applyKnownFixes(config: Record<string, unknown>): { config: Record<string, unknown>; fixed: boolean } {
  let fixed = false;

  // 1. openCodeReview.llm.protocol — runtime crashes without this
  const ocr = config.openCodeReview as Record<string, unknown> | undefined;
  if (ocr && typeof ocr === "object" && !Array.isArray(ocr)) {
    const llm = ocr.llm as Record<string, unknown> | undefined;
    if (llm && typeof llm === "object" && !Array.isArray(llm)) {
      if (llm.protocol === undefined) {
        llm.protocol = "openai-responses";
        fixed = true;
      }
    }
  }

  return { config, fixed };
}

// ─── Schema drift detection ──────────────────────────────────────────────

function detectUnknownKeys(config: Record<string, unknown>): string[] {
  return Object.keys(config).filter((k) => !KNOWN_ROOT_KEYS.has(k));
}

// ─── Required-field extraction from Zod ──────────────────────────────────

function getMissingRequiredPaths(config: Record<string, unknown>): string[] {
  const result = RootAgentConfigSchema.safeParse(config);
  if (result.success) return [];
  return result.error.issues
    .filter((i) => i.code === "invalid_type")
    .map((i) => i.path.join("."));
}

// ─── Interactive prompting ──────────────────────────────────────────────

const MISSING_FIELD_LABELS: Record<string, string> = {
  "openCodeReview.rulesPath": "OpenCodeReview native rules file path",
  "openCodeReview.llm.url": "LLM endpoint URL",
  "openCodeReview.llm.token": "LLM API token",
  "openCodeReview.llm.model": "LLM model name",
  "ado.organization": "Azure DevOps organization",
  "ado.project": "Azure DevOps project",
  "sonarQube.url": "SonarQube server URL",
};

function setNested(obj: Record<string, unknown>, pathArr: string[], value: string): void {
  let current = obj;
  for (let i = 0; i < pathArr.length - 1; i++) {
    if (!current[pathArr[i]] || typeof current[pathArr[i]] !== "object") {
      current[pathArr[i]] = {};
    }
    current = current[pathArr[i]] as Record<string, unknown>;
  }
  current[pathArr[pathArr.length - 1]] = value;
}

/**
 * Prompt the user (interactively) for missing required fields.
 * Returns `true` if the config was updated.
 */
async function promptMissingFields(
  config: Record<string, unknown>,
  missingPaths: string[],
): Promise<boolean> {
  let modified = false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  function ask(path: string): Promise<string | null> {
    const label = MISSING_FIELD_LABELS[path] ?? `Config field "${path}"`;
    const pathArr = path.split(".");
    const currentVal = pathArr.reduce<unknown>((obj, key) => {
      if (obj && typeof obj === "object") return (obj as Record<string, unknown>)[key];
      return undefined;
    }, config);
    const displayValue = currentVal !== undefined ? String(currentVal) : "(not set)";

    return new Promise((resolve) => {
      rl.question(`  ${label} [${displayValue}]: `, (answer) => {
        resolve(answer.trim() || null);
      });
    });
  }

  for (const path of missingPaths) {
    const answer = await ask(path);
    if (answer) {
      setNested(config, path.split("."), answer);
      modified = true;
    }
  }

  rl.close();
  return modified;
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Check a raw (pre-Zod) config for known gaps and repair them.
 *
 * - Fills in known default values that older configs may lack
 * - Detects unknown root-level keys (schema drift)
 * - Reports missing required fields via Zod validation
 *
 * Does NOT write to disk — callers must write back if `result.modified` is true.
 */
export function repairConfig(rawConfig: Record<string, unknown>): RepairResult {
  const warnings: string[] = [];

  // Step 1: Fill in sensible defaults
  const { config, fixed } = applyKnownFixes(rawConfig);

  // Step 2: Detect unknown root-level keys
  const unknownKeys = detectUnknownKeys(config);
  for (const key of unknownKeys) {
    warnings.push(
      `Root-level key "${key}" is not part of the current schema and will be ignored. ` +
      "Consider removing it from the config.",
    );
  }

  // Step 3: Report missing required fields
  const missingPaths = getMissingRequiredPaths(config);
  for (const p of missingPaths) {
    warnings.push(
      `Required field "${p}" is missing from the config. ` +
      "Edit your config file or run interactively to fill it in.",
    );
  }

  return { modified: fixed, config, warnings };
}

/**
 * Like repairConfig() but also prompts the user for missing required fields
 * interactively and writes updated config to disk.
 */
export async function repairConfigInteractive(
  rawConfig: Record<string, unknown>,
  configPath: string,
): Promise<RepairResult> {
  const syncResult = repairConfig(rawConfig);
  const config = syncResult.config;
  let modified = syncResult.modified;

  // Prompt for missing required fields when a terminal is available
  if (process.stdin.isTTY) {
    const missingPaths = getMissingRequiredPaths(config);
    if (missingPaths.length > 0) {
      console.log("\n── Configuration update ──────────────────────────");
      console.log("  Some required configuration fields are missing.");

      const prompted = await promptMissingFields(config, missingPaths);
      if (prompted) {
        modified = true;
        console.log("  Config updated.\n");
        // Check if still missing after prompting
        const stillMissing = getMissingRequiredPaths(config);
        if (stillMissing.length > 0) {
          syncResult.warnings.push(
            "Some required fields are still missing after prompting. " +
            "Edit the config file directly: " + configPath,
          );
        }
      }
    }
  }

  // Write back if anything changed
  if (modified) {
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    } catch (err) {
      syncResult.warnings.push(
        `Failed to write repaired config to ${configPath}: ${(err as Error).message}`,
      );
    }
  }

  return { ...syncResult, modified, config };
}
