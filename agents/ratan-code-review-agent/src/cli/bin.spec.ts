import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const packageRoot = join(import.meta.dirname, "..", "..");
const binPath = join(packageRoot, "bin", "ratan-code-review.js");

describe("CLI binary", () => {
  beforeAll(() => {
    execFileSync("pnpm", ["build"], {
      cwd: packageRoot,
      stdio: "pipe",
    });
  }, 30_000);

  it("prints help through the published bin entrypoint", () => {
    const output = execFileSync("node", [binPath, "--help"], {
      cwd: packageRoot,
      encoding: "utf8",
    });

    expect(output).toContain("Usage: ratan-code-review");
    expect(output).toContain("start");
    expect(output).toContain("dashboard");
    expect(output).toContain("Cheatsheet:");
    expect(output).toContain("ratan-code-review start --pr-id 123");
    expect(output).toContain("ratan-code-review start --watch");
    expect(output).toContain("ratan-code-review dashboard --port 3000");
  });

  it("documents direct PR review for start", () => {
    const output = execFileSync("node", [binPath, "start", "--help"], {
      cwd: packageRoot,
      encoding: "utf8",
    });

    expect(output).toContain("--pr-id <number>");
  });
});
