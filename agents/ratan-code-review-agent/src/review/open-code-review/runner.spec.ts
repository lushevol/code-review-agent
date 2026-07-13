import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OpenCodeReviewRunner } from "./runner";
import type { ReviewWorkspace } from "../workspace/types";

const tempDirs: string[] = [];

function fakeBinary(output: string, exitCode = 0) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-runner-"));
  tempDirs.push(dir);
  const binary = path.join(dir, "fake-ocr");
  fs.writeFileSync(
    binary,
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(process.env.OCR_TEST_CAPTURE, JSON.stringify({ args: process.argv.slice(2), home: process.env.HOME, noUpdate: process.env.OCR_NO_UPDATE }));
process.stdout.write(${JSON.stringify(output)});
process.exit(${exitCode});
`,
  );
  fs.chmodSync(binary, 0o755);
  return { dir, binary, capture: path.join(dir, "capture.json") };
}

function workspace(root: string): ReviewWorkspace {
  const repoPath = path.join(root, "repo");
  const runDirectory = path.join(root, "run");
  fs.mkdirSync(repoPath, { recursive: true });
  fs.mkdirSync(runDirectory, { recursive: true });
  return {
    repoPath,
    runDirectory,
    mergeBaseCommit: "base-sha",
    headCommit: "head-sha",
    changes: [],
  };
}

function ruleFile(root: string) {
  const file = path.join(root, "rule.json");
  fs.writeFileSync(file, JSON.stringify({ rules: [] }));
  return file;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("OpenCodeReviewRunner", () => {
  it("executes the structured range review with isolated state", async () => {
    const fixture = fakeBinary(
      JSON.stringify({
        status: "success",
        trace_id: "trace-1",
        session_id: "session-1",
        comments: [
          {
            path: "src/file.ts",
            content: "Fix this",
            start_line: 3,
            end_line: 3,
            category: "bug",
            severity: "high",
          },
        ],
        summary: { files_reviewed: 1, comments: 1, total_tokens: 10, input_tokens: 7, output_tokens: 3, elapsed: "1s" },
        tool_calls: { total: 0, by_tool: {} },
      }),
    );
    process.env.OCR_TEST_CAPTURE = fixture.capture;
    const runner = new OpenCodeReviewRunner({
      binaryPath: fixture.binary,
      environment: {
        OCR_LLM_URL: "https://llm.example/v1",
        OCR_LLM_TOKEN: "secret",
        OCR_LLM_MODEL: "model",
      },
    });
    const reviewWorkspace = workspace(fixture.dir);

    const result = await runner.review({
      workspace: reviewWorkspace,
      background: "PR context",
      llm: { url: "https://llm.example/v1", token: "secret", model: "model", useAnthropic: false },
      ruleFile: ruleFile(fixture.dir),
    });

    expect(result.status).toBe("success");
    expect(result.complete).toBe(true);
    expect(result.comments).toHaveLength(1);
    const capture = JSON.parse(fs.readFileSync(fixture.capture, "utf8"));
    expect(capture.args).toEqual(
      expect.arrayContaining([
        "review",
        "--repo",
        reviewWorkspace.repoPath,
        "--from",
        "base-sha",
        "--to",
        "head-sha",
        "--format",
        "json",
        "--audience",
        "agent",
      ]),
    );
    expect(capture.noUpdate).toBe("1");
    expect(capture.home).toContain(reviewWorkspace.runDirectory);
    expect(fs.existsSync(capture.home)).toBe(false);
  });

  it("marks OCR partial errors incomplete", async () => {
    const fixture = fakeBinary(
      JSON.stringify({
        status: "completed_with_errors",
        comments: [],
        warnings: [{ type: "subtask_error", message: "failed" }],
        tool_calls: { total: 0, by_tool: {} },
      }),
    );
    const runner = new OpenCodeReviewRunner({
      binaryPath: fixture.binary,
      environment: {
        OCR_LLM_URL: "https://llm.example/v1",
        OCR_LLM_TOKEN: "secret",
        OCR_LLM_MODEL: "model",
        OCR_TEST_CAPTURE: fixture.capture,
      },
    });

    const result = await runner.review({
      workspace: workspace(fixture.dir),
      background: "",
      llm: { url: "https://llm.example/v1", token: "secret", model: "model", useAnthropic: false },
      ruleFile: ruleFile(fixture.dir),
    });

    expect(result.complete).toBe(false);
    expect(result.warnings[0]?.type).toBe("subtask_error");
  });

  it("rejects malformed JSON without logging its contents", async () => {
    const fixture = fakeBinary("not-json");
    const runner = new OpenCodeReviewRunner({
      binaryPath: fixture.binary,
      environment: {
        OCR_LLM_URL: "https://llm.example/v1",
        OCR_LLM_TOKEN: "secret",
        OCR_LLM_MODEL: "model",
        OCR_TEST_CAPTURE: fixture.capture,
      },
    });

    await expect(
      runner.review({
        workspace: workspace(fixture.dir),
        background: "",
        llm: { url: "https://llm.example/v1", token: "secret", model: "model", useAnthropic: false },
        ruleFile: ruleFile(fixture.dir),
      }),
    ).rejects.toThrow("invalid JSON output");
  });
});
