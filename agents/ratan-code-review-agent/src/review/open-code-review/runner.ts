import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getLogger } from "ratan-logger";
import { FindingCategory } from "../types/finding";
import { maskSensitiveData } from "../utils/sensitive-data-mask";
import type { ReviewWorkspace } from "../workspace/types";

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const ocrRunnerLogger = getLogger("ocr-runner");
const OcrCommentCategorySchema = z.preprocess(
  (value) =>
    typeof value === "string" && !FindingCategory.safeParse(value).success
      ? "other"
      : value,
  FindingCategory,
);

const OcrCommentSchema = z.object({
  path: z.string(),
  content: z.string(),
  suggestion_code: z.string().optional(),
  existing_code: z.string().optional(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  thinking: z.string().optional(),
  category: OcrCommentCategorySchema.optional(),
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
  rawOutput: string;
};

export interface OcrReviewInput {
  workspace: ReviewWorkspace;
  background: string;
  llm: {
    url: string;
    token: string;
    model: string;
    protocol?: "anthropic" | "openai" | "openai-responses";
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
    const maskedRange = createMaskedGitRange(input.workspace);
    const stateHome = path.join(input.workspace.runDirectory, "ocr-home");
    const backgroundFile = path.join(
      input.workspace.runDirectory,
      "review-background.md",
    );
    try {
      fs.mkdirSync(stateHome, { recursive: true, mode: 0o700 });
      fs.writeFileSync(backgroundFile, maskSensitiveData(input.background), { mode: 0o600 });
      if (!fs.existsSync(input.ruleFile)) {
        throw new Error("OpenCodeReview rule file not found");
      }
      try {
        JSON.parse(fs.readFileSync(input.ruleFile, "utf8"));
      } catch {
        throw new Error("OpenCodeReview rule file is invalid");
      }
      const configDirectory = path.join(stateHome, ".opencodereview");
      const configPath = path.join(configDirectory, "config.json");
      const llmConfig: Record<string, unknown> = {
        url: input.llm.url,
        auth_token: input.llm.token,
        model: input.llm.model,
      };
      if (input.llm.protocol) {
        llmConfig.protocol = input.llm.protocol;
      }
      fs.mkdirSync(configDirectory, { recursive: true, mode: 0o700 });
      fs.writeFileSync(
        configPath,
        JSON.stringify({ llm: llmConfig }),
        { mode: 0o600 },
      );

      ocrRunnerLogger.info("Starting OCR review", {
        model: input.llm.model,
        ruleFile: input.ruleFile,
        fromCommit: maskedRange.mergeBaseCommit.slice(0, 12),
        toCommit: maskedRange.headCommit.slice(0, 12),
        concurrency: this.concurrency,
        timeoutMs: this.timeoutMs,
      });
      const stdout = await this.execute(
        [
          "review",
          "--repo",
          maskedRange.repoPath,
          "--from",
          maskedRange.mergeBaseCommit,
          "--to",
          maskedRange.headCommit,
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
        input.llm.protocol,
      );
      let json: unknown;
      try {
        json = JSON.parse(stdout);
      } catch {
        throw new Error("OpenCodeReview returned invalid JSON output");
      }
      const parsed = OcrOutputSchema.parse(json);
      const durationMs = Date.now() - startedAt;
      ocrRunnerLogger.info("OCR review completed", {
        status: parsed.status,
        durationMs,
        filesReviewed: parsed.summary?.files_reviewed,
        totalTokens: parsed.summary?.total_tokens,
        comments: parsed.summary?.comments,
        warnings: parsed.warnings?.length ?? 0,
        complete: parsed.status !== "completed_with_errors",
      });
      return {
        ...parsed,
        complete: parsed.status !== "completed_with_errors",
        durationMs,
        rawOutput: stdout,
      };
    } finally {
      fs.rmSync(stateHome, { recursive: true, force: true });
      maskedRange.cleanup();
    }
  }

  private execute(
    args: string[],
    home: string,
    configPath: string,
    protocol?: string,
  ): Promise<string> {
    const env = this.buildEnvironment(home, configPath, protocol);
    return new Promise((resolve, reject) => {
      const child = spawn(this.binaryPath, args, {
        env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
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
      child.stderr.on("data", (chunk: Buffer) => {
        stderr.push(chunk);
      });
      child.on("error", () => {
        finish(new Error("OpenCodeReview could not be started"));
      });
      child.on("close", (code) => {
        if (code !== 0) {
          const stderrOutput = Buffer.concat(stderr).toString("utf8").trim();
          const message = stderrOutput
            ? `OpenCodeReview exited with code ${code ?? "unknown"}: ${stderrOutput}`
            : `OpenCodeReview exited with code ${code ?? "unknown"}`;
          finish(new Error(message));
          return;
        }
        finish(undefined, Buffer.concat(stdout).toString("utf8"));
      });
    });
  }

  private buildEnvironment(
    home: string,
    _configPath: string,
    protocol?: string,
  ): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...this.environment,
      HOME: home,
      OCR_NO_UPDATE: "1",
    };
    if (protocol) {
      env.OCR_LLM_PROTOCOL = protocol;
    }
    return env;
  }
}

function createMaskedGitRange(workspace: ReviewWorkspace): {
  repoPath: string;
  mergeBaseCommit: string;
  headCommit: string;
  cleanup(): void;
} {
  if (workspace.changes.length === 0) {
    return {
      repoPath: workspace.repoPath,
      mergeBaseCommit: workspace.mergeBaseCommit,
      headCommit: workspace.headCommit,
      cleanup() {},
    };
  }

  const repoPath = path.join(workspace.runDirectory, "masked-review-repo");
  const redactionKey = randomBytes(32);
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: repoPath,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    }).trim();

  try {
    execFileSync(
      "git",
      ["clone", "--quiet", "--shared", "--no-checkout", workspace.repoPath, repoPath],
      { encoding: "utf8", windowsHide: true },
    );
    git("config", "user.email", "masked-review@localhost.invalid");
    git("config", "user.name", "PR Guardian Masking");
    git("checkout", "--quiet", "--detach", workspace.mergeBaseCommit);
    maskChangedFiles(repoPath, workspace.changes, "base", redactionKey);
    git("add", "--all");
    git("commit", "--quiet", "--allow-empty", "-m", "masked review base");
    const mergeBaseCommit = git("rev-parse", "HEAD");

    git("read-tree", "--reset", "-u", workspace.headCommit);
    maskChangedFiles(repoPath, workspace.changes, "head", redactionKey);
    git("add", "--all");
    git("commit", "--quiet", "--allow-empty", "-m", "masked review head");
    const headCommit = git("rev-parse", "HEAD");

    return {
      repoPath,
      mergeBaseCommit,
      headCommit,
      cleanup() {
        fs.rmSync(repoPath, { recursive: true, force: true });
      },
    };
  } catch (error) {
    fs.rmSync(repoPath, { recursive: true, force: true });
    throw error;
  }
}

function maskChangedFiles(
  repoPath: string,
  changes: ReviewWorkspace["changes"],
  revision: "base" | "head",
  redactionKey: Buffer,
): void {
  for (const change of changes) {
    const relativePath = revision === "base" ? change.previousPath ?? change.path : change.path;
    const filePath = path.join(repoPath, relativePath);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) continue;
    const bytes = fs.readFileSync(filePath);
    if (bytes.includes(0)) continue;
    fs.writeFileSync(
      filePath,
      maskDiffContent(bytes.toString("utf8"), redactionKey),
    );
  }
}

function maskDiffContent(content: string, redactionKey: Buffer): string {
  const masked = maskSensitiveData(content);
  const originalLines = content.split("\n");
  return masked
    .split("\n")
    .map((line, index) => {
      if (!/(\*\*\*\*|API_KEY|TOKEN)/.test(line)) return line;
      const digest = createHmac("sha256", redactionKey)
        .update(originalLines[index] ?? "")
        .digest("hex")
        .slice(0, 12);
      return line.replaceAll("****", `****:${digest}`)
        .replaceAll("API_KEY", `[REDACTED:${digest}]`)
        .replaceAll("TOKEN", `[REDACTED:${digest}]`);
    })
    .join("\n");
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
