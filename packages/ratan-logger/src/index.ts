import fs from "node:fs";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFormat = "pretty" | "json";

export interface LoggingOptions {
  level?: LogLevel;
  directory?: string;
  retentionDays?: number;
  format?: LogFormat;
  console?: boolean;
  file?: boolean;
}

interface ResolvedLoggingOptions extends Required<LoggingOptions> {}

type LogValue = string | number | boolean | null;
type LogFields = Record<string, LogValue>;

const levelOrder: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
let options: ResolvedLoggingOptions = {
  level: "info",
  directory: path.resolve(process.cwd(), ".ratan/logs"),
  retentionDays: 30,
  format: "pretty",
  console: true,
  file: true,
};
const consoleSink = { log: console.log.bind(console), warn: console.warn.bind(console), error: console.error.bind(console) };
let consoleCaptureInstalled = false;

function redactString(value: string): string {
  return value
    .replace(/(bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:token|password|secret|api[_-]?key)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/((?:token|password|secret|api[_-]?key)\s*[:=]\s*)[^,\s}]+/gi, "$1[REDACTED]");
}

function redactValue(value: LogValue, key: string): LogValue {
  if (/token|password|secret|authorization|api[_-]?key/i.test(key)) {
    return "[REDACTED]";
  }
  return typeof value === "string" ? redactString(value) : value;
}

const reservedFields = new Set(["timestamp", "level", "component", "message"]);

function collectFields(args: unknown[], includeStack: boolean): LogFields {
  const fields: LogFields = {};

  const addError = (error: Error) => {
    fields.error = redactString(error.message);
    if (includeStack && error.stack) fields.errorStack = redactString(error.stack);
  };

  for (const arg of args) {
    if (arg instanceof Error) {
      addError(arg);
      continue;
    }
    if (!arg || typeof arg !== "object" || Array.isArray(arg)) continue;

    for (const [key, value] of Object.entries(arg)) {
      if (reservedFields.has(key) || key === "stack") continue;
      if (value instanceof Error) {
        addError(value);
      } else if (Array.isArray(value)) {
        fields[`${key}Count`] = value.length;
        const typedItems = value.filter(
          (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object",
        );
        const types = [...new Set(typedItems
          .map((item) => item.type)
          .filter((type): type is string => typeof type === "string"))]
          .slice(0, 5);
        if (types.length > 0) fields[`${key}Types`] = types.map(redactString).join(",");
        const messages = typedItems
          .map((item) => item.message)
          .filter((item): item is string => typeof item === "string")
          .slice(0, 3)
          .map((item) => redactString(item).slice(0, 160));
        if (messages.length > 0) fields[`${key}Messages`] = messages.join(" | ");
      } else if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        fields[key] = redactValue(value, key);
      }
    }
  }

  return fields;
}

function formatValue(value: LogValue): string {
  if (typeof value === "string" && /^[\w./:#-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

export function configureLogging(next: LoggingOptions = {}): void {
  options = { ...options, ...next, directory: next.directory ? path.resolve(next.directory) : options.directory };
  if (options.file) fs.mkdirSync(options.directory, { recursive: true });
  cleanOldLogs(options.retentionDays, options.directory);
}

export class Logger {
  constructor(private readonly component: string) {}

  private log(level: LogLevel, message: string, args: unknown[]): void {
    if (levelOrder[level] < levelOrder[options.level]) return;
    const fields = collectFields(args, options.level === "debug");
    const record = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      message,
      ...fields,
    };
    const json = JSON.stringify(record);
    const context = Object.entries(fields)
      .map(([key, value]) => `${key}=${formatValue(value)}`)
      .join(" ");
    const output = options.format === "json"
      ? json
      : `${record.timestamp} ${level.toUpperCase().padEnd(5)} [${this.component}] ${message}${context ? ` ${context}` : ""}`;
    if (options.console) {
      if (level === "error") consoleSink.error(output);
      else if (level === "warn") consoleSink.warn(output);
      else consoleSink.log(output);
    }
    if (options.file) {
      try {
        const date = record.timestamp.slice(0, 10);
        const file = path.join(options.directory, `${date}${level === "error" ? "-error" : ""}.jsonl`);
        fs.appendFileSync(file, `${json}\n`, "utf8");
      } catch { /* logging must never take down the agent */ }
    }
  }

  debug(message: string, ...args: unknown[]) { this.log("debug", message, args); }
  info(message: string, ...args: unknown[]) { this.log("info", message, args); }
  warn(message: string, ...args: unknown[]) { this.log("warn", message, args); }
  error(message: string, ...args: unknown[]) { this.log("error", message, args); }
  child(name: string) { return new Logger(`${this.component}:${name}`); }
}

/** Routes legacy console calls through the configured structured logger. */
export function installConsoleCapture(): void {
  if (consoleCaptureInstalled) return;
  consoleCaptureInstalled = true;
  const route = (level: LogLevel, args: unknown[]) => {
    const rawMessage = String(args[0] ?? "");
    const sourcePrefix = rawMessage.match(/^\[([^\]]+)]\s*/);
    const logger = getLogger(sourcePrefix?.[1] ?? "legacy");
    const message = sourcePrefix ? rawMessage.slice(sourcePrefix[0].length) : rawMessage;
    logger[level](message, ...args.slice(1));
  };
  console.log = (...args: unknown[]) => route("info", args);
  console.warn = (...args: unknown[]) => route("warn", args);
  console.error = (...args: unknown[]) => route("error", args);
}

let rootLogger: Logger | undefined;
export function getLogger(name?: string): Logger {
  rootLogger ??= new Logger("agent");
  return name ? new Logger(name) : rootLogger;
}

export function cleanOldLogs(days = options.retentionDays, directory = options.directory): void {
  try {
    if (!fs.existsSync(directory)) return;
    const cutoff = Date.now() - days * 86_400_000;
    for (const file of fs.readdirSync(directory)) {
      const filePath = path.join(directory, file);
      if (file.endsWith(".jsonl") && fs.statSync(filePath).mtimeMs < cutoff) fs.unlinkSync(filePath);
    }
  } catch { /* retention is best effort */ }
}
