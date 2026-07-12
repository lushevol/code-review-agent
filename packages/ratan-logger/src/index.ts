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

function redact(value: unknown, key?: string): unknown {
  if (key && /token|password|secret|authorization|api[_-]?key/i.test(key)) return "[REDACTED]";
  if (value instanceof Error) return { name: value.name, message: redactString(value.message), stack: value.stack ? redactString(value.stack) : undefined };
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item, name)]));
  }
  return value;
}

export function configureLogging(next: LoggingOptions = {}): void {
  options = { ...options, ...next, directory: next.directory ? path.resolve(next.directory) : options.directory };
  if (options.file) fs.mkdirSync(options.directory, { recursive: true });
  cleanOldLogs(options.retentionDays, options.directory);
}

export class Logger {
  constructor(private readonly name: string) {}

  private log(level: LogLevel, message: string, args: unknown[]): void {
    if (levelOrder[level] < levelOrder[options.level]) return;
    const record = {
      timestamp: new Date().toISOString(), level, service: this.name, message,
      ...(args.length ? { data: redact(args.length === 1 ? args[0] : args) } : {}),
    };
    const json = JSON.stringify(record);
    const output = options.format === "json" ? json : `${record.timestamp} [${level.toUpperCase()}] [${this.name}] ${message}${args.length ? ` ${JSON.stringify(record.data)}` : ""}`;
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
  child(name: string) { return new Logger(`${this.name}:${name}`); }
}

/** Routes legacy console calls through the configured structured logger. */
export function installConsoleCapture(): void {
  if (consoleCaptureInstalled) return;
  consoleCaptureInstalled = true;
  const logger = getLogger("console");
  console.log = (...args: unknown[]) => logger.info(String(args[0] ?? ""), ...args.slice(1));
  console.warn = (...args: unknown[]) => logger.warn(String(args[0] ?? ""), ...args.slice(1));
  console.error = (...args: unknown[]) => logger.error(String(args[0] ?? ""), ...args.slice(1));
}

let rootLogger: Logger | undefined;
export function getLogger(name?: string): Logger {
  rootLogger ??= new Logger("ratan-code-review");
  return name ? rootLogger.child(name) : rootLogger;
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
