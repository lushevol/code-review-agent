import { afterEach, describe, expect, it, vi } from "vitest";

const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
};

afterEach(() => {
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("console rendering", () => {
  it("renders focused pretty lines with the source component", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { configureLogging, getLogger } = await import("./index");
    configureLogging({ format: "pretty", console: true, file: false });

    getLogger("review").info("review.started", { prId: 42 });

    expect(output).toHaveBeenCalledWith(
      expect.stringMatching(
        / INFO\s+\[review] review\.started prId=42$/,
      ),
    );
  });

  it("routes bracket-prefixed legacy messages through their component", async () => {
    const output = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { configureLogging, installConsoleCapture } = await import("./index");
    configureLogging({ format: "pretty", console: true, file: false });
    installConsoleCapture();

    console.warn("[scanner-pipeline] persistence failed");

    expect(output).toHaveBeenCalledWith(
      expect.stringMatching(
        / WARN\s+\[scanner-pipeline] persistence failed$/,
      ),
    );
  });
});
