import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface StudioOptions {
  config?: string;
  port?: number;
}

export async function studio(options: StudioOptions) {
  // Resolve the package root to find .mastra/output/
  const packageRoot = path.resolve(__dirname, "../../../..");
  const mastraOutput = path.resolve(packageRoot, ".mastra/output/index.mjs");

  let entryPoint = mastraOutput;
  try {
    await import("node:fs/promises").then(fs => fs.access(entryPoint));
  } catch {
    console.error(
      `\n  Error: Mastra output not found at ${entryPoint}\n` +
      "  The .mastra/ directory should be included in the installed package.\n" +
      "  Try reinstalling: npm install -g ratan-code-review\n"
    );
    process.exit(1);
  }

  const loaderFlag = path.resolve(packageRoot, "scripts/protobufjs-esm-loader.mjs");
  const instrumentationFlag = path.resolve(packageRoot, ".mastra/output/instrumentation.mjs");

  const args = [
    `--loader=${loaderFlag}`,
    `--import=${instrumentationFlag}`,
    entryPoint,
    ...(options.port ? ["--port", String(options.port)] : []),
  ];

  console.log(`Starting Mastra Studio...`);
  if (options.port) {
    console.log(`  Port: ${options.port}`);
  }

  const child = spawn("node", args, {
    stdio: "inherit",
    env: { ...process.env },
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}
