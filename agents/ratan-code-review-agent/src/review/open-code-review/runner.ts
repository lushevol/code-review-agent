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
  llm: {
    url: string;
    token: string;
    model: string;
    useAnthropic: boolean;
  };
  ruleFile: string;
}

export interface OcrReviewRunner {
  review(input: OcrReviewInput): Promise<OcrReviewOutput>;
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
    fs.mkdirSync(stateHome, { recursive: true, mode: 0o700 });
    fs.writeFileSync(backgroundFile, input.background, { mode: 0o600 });
    if (!fs.existsSync(input.ruleFile)) {
      throw new Error("OpenCodeReview rule file not found");
    }
    try {
      JSON.parse(fs.readFileSync(input.ruleFile, "utf8"));
    } catch {
      throw new Error("OpenCodeReview rule file is invalid");
    }
    const configPath = path.join(stateHome, "config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        llm: {
          url: input.llm.url,
          auth_token: input.llm.token,
          model: input.llm.model,
          use_anthropic: input.llm.useAnthropic,
        },
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
          input.ruleFile,
          "--concurrency",
          String(this.concurrency),
        ],
        stateHome,
        configPath,
        input.llm.useAnthropic,
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

  private execute(
    args: string[],
    home: string,
    configPath: string,
    useAnthropic: boolean,
  ): Promise<string> {
    const env = this.buildEnvironment(home, configPath, useAnthropic);
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

  private buildEnvironment(
    home: string,
    configPath: string,
    useAnthropic: boolean,
  ): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...this.environment,
      HOME: home,
      OCR_CONFIG_PATH: configPath,
      OCR_NO_UPDATE: "1",
      OCR_USE_ANTHROPIC: String(useAnthropic),
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
