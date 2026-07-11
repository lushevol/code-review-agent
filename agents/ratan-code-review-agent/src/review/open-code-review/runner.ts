import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ReviewWorkspace } from "../workspace/types";

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;

const OcrCommentSchema = z.object({
  path: z.string(),
  content: z.string(),
  suggestion_code: z.string().optional(),
  existing_code: z.string().optional(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  thinking: z.string().optional(),
  category: z
    .enum([
      "bug",
      "security",
      "performance",
      "maintainability",
      "test",
      "style",
      "documentation",
      "other",
    ])
    .optional(),
  severity: z.enum(["critical", "high", "medium", "low"]).optional(),
});

const OcrWarningSchema = z
  .object({
    type: z.string(),
    message: z.string(),
  })
  .passthrough();

const OcrOutputSchema = z.object({
  status: z.enum([
    "success",
    "skipped",
    "completed_with_warnings",
    "completed_with_errors",
  ]),
  trace_id: z.string().optional(),
  session_id: z.string().optional(),
  message: z.string().optional(),
  comments: z.array(OcrCommentSchema),
  warnings: z.array(OcrWarningSchema).optional().default([]),
  summary: z
    .object({
      files_reviewed: z.number().int(),
      comments: z.number().int(),
      total_tokens: z.number().int(),
      input_tokens: z.number().int(),
      output_tokens: z.number().int(),
      cache_read_tokens: z.number().int().optional(),
      cache_write_tokens: z.number().int().optional(),
      elapsed: z.string(),
    })
    .optional(),
  tool_calls: z
    .object({
      total: z.number().int(),
      by_tool: z.record(z.string(), z.number().int()),
    })
    .nullable()
    .optional(),
});

export type OcrReviewOutput = z.infer<typeof OcrOutputSchema> & {
  complete: boolean;
  durationMs: number;
};

export interface OcrReviewInput {
  workspace: ReviewWorkspace;
  background: string;
  include: string[];
  exclude: string[];
}

export interface OcrReviewRunner {
  review(input: OcrReviewInput): Promise<OcrReviewOutput>;
  checkHealth(): Promise<boolean>;
}

export interface OpenCodeReviewRunnerOptions {
  binaryPath?: string;
  concurrency?: number;
  timeoutMs?: number;
  environment?: NodeJS.ProcessEnv;
}

export class OpenCodeReviewRunner implements OcrReviewRunner {
  private readonly binaryPath: string;
  private readonly concurrency: number;
  private readonly timeoutMs: number;
  private readonly environment: NodeJS.ProcessEnv;

  constructor(options: OpenCodeReviewRunnerOptions = {}) {
    this.binaryPath = options.binaryPath ?? resolveOcrBinary();
    this.concurrency = options.concurrency ?? 8;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.environment = options.environment ?? process.env;
  }

  async review(input: OcrReviewInput): Promise<OcrReviewOutput> {
    const startedAt = Date.now();
    const stateHome = path.join(input.workspace.runDirectory, "ocr-home");
    const backgroundFile = path.join(
      input.workspace.runDirectory,
      "review-background.md",
    );
    const ruleFile = path.join(input.workspace.runDirectory, "ocr-rule.json");
    fs.mkdirSync(stateHome, { recursive: true, mode: 0o700 });
    fs.writeFileSync(backgroundFile, input.background, { mode: 0o600 });
    fs.writeFileSync(
      ruleFile,
      JSON.stringify({
        rules: [],
        include: input.include,
        exclude: input.exclude,
      }),
      { mode: 0o600 },
    );

    try {
      const stdout = await this.execute(
        [
          "review",
          "--repo",
          input.workspace.repoPath,
          "--from",
          input.workspace.mergeBaseCommit,
          "--to",
          input.workspace.headCommit,
          "--format",
          "json",
          "--audience",
          "agent",
          "--background-file",
          backgroundFile,
          "--rule",
          ruleFile,
          "--concurrency",
          String(this.concurrency),
        ],
        stateHome,
      );
      let json: unknown;
      try {
        json = JSON.parse(stdout);
      } catch {
        throw new Error("OpenCodeReview returned invalid JSON output");
      }
      const parsed = OcrOutputSchema.parse(json);
      return {
        ...parsed,
        complete: parsed.status !== "completed_with_errors",
        durationMs: Date.now() - startedAt,
      };
    } finally {
      fs.rmSync(stateHome, { recursive: true, force: true });
    }
  }

  async checkHealth(): Promise<boolean> {
    const home = fs.mkdtempSync(path.join(process.cwd(), ".ocr-health-"));
    try {
      await this.execute(["llm", "test"], home);
      return true;
    } catch {
      return false;
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }

  private execute(args: string[], home: string): Promise<string> {
    const env = this.buildEnvironment(home);
    return new Promise((resolve, reject) => {
      const child = spawn(this.binaryPath, args, {
        env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      let stdoutBytes = 0;
      let settled = false;
      const finish = (error?: Error, output?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(output ?? "");
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(new Error("OpenCodeReview timed out"));
      }, this.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_OUTPUT_BYTES) {
          child.kill("SIGKILL");
          finish(new Error("OpenCodeReview output exceeded 16 MiB"));
          return;
        }
        stdout.push(chunk);
      });
      child.on("error", () => {
        finish(new Error("OpenCodeReview could not be started"));
      });
      child.on("close", (code) => {
        if (code !== 0) {
          finish(new Error(`OpenCodeReview exited with code ${code ?? "unknown"}`));
          return;
        }
        finish(undefined, Buffer.concat(stdout).toString("utf8"));
      });
    });
  }

  private buildEnvironment(home: string): NodeJS.ProcessEnv {
    const source = this.environment;
    const url = source.OCR_LLM_URL ?? source.OPENAI_BASE_URL;
    const token = source.OCR_LLM_TOKEN ?? source.OPENAI_API_KEY;
    const model = source.OCR_LLM_MODEL;
    if (!url || !token || !model) {
      throw new Error(
        "OpenCodeReview requires OCR_LLM_MODEL and an OCR or OPENAI endpoint/token",
      );
    }
    return {
      ...process.env,
      ...source,
      HOME: home,
      OCR_CONFIG_PATH: path.join(home, "config.json"),
      OCR_NO_UPDATE: "1",
      OCR_LLM_URL: url,
      OCR_LLM_TOKEN: token,
      OCR_LLM_MODEL: model,
      OCR_USE_ANTHROPIC: "false",
    };
  }
}

function resolveOcrBinary(): string {
  if (process.env.OCR_BINARY_PATH) return process.env.OCR_BINARY_PATH;
  const require = createRequire(import.meta.url);
  const platformModule = require(
    require.resolve("@alibaba-group/open-code-review/scripts/platform.js"),
  ) as { resolveNativeBinary(): { path: string } | null };
  const resolved = platformModule.resolveNativeBinary();
  if (!resolved) {
    throw new Error("OpenCodeReview native binary is not installed for this platform");
  }
  return resolved.path;
}
