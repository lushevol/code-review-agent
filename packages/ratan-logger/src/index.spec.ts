import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configureLogging, getLogger } from "./index";

const directories: string[] = [];

afterEach(() => {
  configureLogging({
    level: "info",
    directory: path.resolve(process.cwd(), ".ratan/logs"),
    format: "pretty",
    console: true,
    file: true,
  });
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("focused log records", () => {
  it("writes flat scalar context and omits bundled nested payloads", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ratan-logger-"));
    directories.push(directory);
    configureLogging({
      level: "info",
      directory,
      format: "json",
      console: false,
      file: true,
    });

    getLogger("review").info("review.step.completed", {
      prId: 42,
      step: "scanner-pipeline",
      findings: [{ id: "large-nested-payload" }],
      output: { duplicated: "workflow output" },
      warnings: [
        { type: "timeout", message: "Bearer diagnostic-secret timed out" },
        { type: "subtask_error", message: "Review worker failed" },
      ],
      token: "do-not-log-this",
      note: "Bearer do-not-log-this-either",
      timestamp: "reserved-value",
    });

    const logFile = path.join(
      directory,
      `${new Date().toISOString().slice(0, 10)}.jsonl`,
    );
    const record = JSON.parse(fs.readFileSync(logFile, "utf8"));

    expect(record).toMatchObject({
      level: "info",
      component: "review",
      message: "review.step.completed",
      prId: 42,
      step: "scanner-pipeline",
      findingsCount: 1,
      warningsCount: 2,
      warningsTypes: "timeout,subtask_error",
      warningsMessages: "Bearer [REDACTED] timed out | Review worker failed",
      token: "[REDACTED]",
      note: "Bearer [REDACTED]",
    });
    expect(record).not.toHaveProperty("data");
    expect(record).not.toHaveProperty("findings");
    expect(record).not.toHaveProperty("output");
    expect(record.timestamp).not.toBe("reserved-value");
  });

  it("keeps error messages but emits stacks only at debug level", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ratan-logger-"));
    directories.push(directory);
    configureLogging({
      level: "info",
      directory,
      format: "json",
      console: false,
      file: true,
    });

    getLogger("review").error("review.failed", new Error("scanner unavailable"));

    const errorFile = path.join(
      directory,
      `${new Date().toISOString().slice(0, 10)}-error.jsonl`,
    );
    const record = JSON.parse(fs.readFileSync(errorFile, "utf8"));

    expect(record.error).toBe("scanner unavailable");
    expect(record).not.toHaveProperty("errorStack");
  });

  it("includes error stacks when debug logging is enabled", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ratan-logger-"));
    directories.push(directory);
    configureLogging({
      level: "debug",
      directory,
      format: "json",
      console: false,
      file: true,
    });

    getLogger("review").error("review.failed", new Error("scanner unavailable"));

    const errorFile = path.join(
      directory,
      `${new Date().toISOString().slice(0, 10)}-error.jsonl`,
    );
    const record = JSON.parse(fs.readFileSync(errorFile, "utf8"));

    expect(record.errorStack).toContain("Error: scanner unavailable");
  });
});
