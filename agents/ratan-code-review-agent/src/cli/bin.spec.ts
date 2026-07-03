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
  });

  it("prints help through the published bin entrypoint", () => {
    const output = execFileSync("node", [binPath, "--help"], {
      cwd: packageRoot,
      encoding: "utf8",
    });

    expect(output).toContain("Usage: ratan-code-review");
    expect(output).toContain("scan");
    expect(output).toContain("studio");
    expect(output).toContain("init");
  });

  it("documents direct PR review for scan", () => {
    const output = execFileSync("node", [binPath, "scan", "--help"], {
      cwd: packageRoot,
      encoding: "utf8",
    });

    expect(output).toContain("--pr-id <number>");
  });
});
