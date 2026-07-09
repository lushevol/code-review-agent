import fs from "node:fs";
import path from "node:path";

// ─── Log Levels ──────────────────────────────────────────────────────────────

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ─── Logger ──────────────────────────────────────────────────────────────────

export class Logger {
  private name: string;
  private logDir: string;
  private minLevel: LogLevel;

  constructor(name: string, logDir?: string) {
    this.name = name;
    this.logDir = logDir ?? path.resolve(process.cwd(), ".ratan/logs");
    this.minLevel = (process.env.LOG_LEVEL as LogLevel) ?? "info";
    this.ensureLogDir();
  }

  private ensureLogDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private log(level: LogLevel, message: string, ...args: unknown[]) {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;

    const timestamp = new Date().toISOString();
    const formatted =
      args.length > 0
        ? `${timestamp} [${level.toUpperCase()}] [${this.name}] ${message} ${args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")}`
        : `${timestamp} [${level.toUpperCase()}] [${this.name}] ${message}`;

    // Console output
    switch (level) {
      case "error":
        console.error(formatted);
        break;
      case "warn":
        console.warn(formatted);
        break;
      default:
        console.log(formatted);
    }

    // File output (append to daily-rotated files)
    this.writeToFile(level, formatted);
  }

  private writeToFile(level: LogLevel, message: string) {
    try {
      const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const filePath = path.join(
        this.logDir,
        level === "error" ? `${date}-error.log` : `${date}-combined.log`,
      );
      fs.appendFileSync(filePath, message + "\n", "utf-8");
    } catch {
      // Silently fail — don't let logging break the app
    }
  }

  debug(message: string, ...args: unknown[]) {
    this.log("debug", message, ...args);
  }

  info(message: string, ...args: unknown[]) {
    this.log("info", message, ...args);
  }

  warn(message: string, ...args: unknown[]) {
    this.log("warn", message, ...args);
  }

  error(message: string, ...args: unknown[]) {
    this.log("error", message, ...args);
  }

  child(name: string): Logger {
    return new Logger(`${this.name}:${name}`, this.logDir);
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _rootLogger: Logger | null = null;

export function getLogger(name?: string): Logger {
  if (!_rootLogger) {
    _rootLogger = new Logger("ratan-code-review");
  }
  return name ? _rootLogger.child(name) : _rootLogger;
}

/**
 * Rotate old log files (delete logs older than `days` days).
 * Call this once at startup.
 */
export function cleanOldLogs(days = 30, logDir?: string) {
  try {
    const dir = logDir ?? path.resolve(process.cwd(), ".ratan/logs");
    if (!fs.existsSync(dir)) return;

    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(dir);

    for (const file of files) {
      if (!file.endsWith(".log")) continue;
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
      }
    }
  } catch {
    // Non-fatal
  }
}
