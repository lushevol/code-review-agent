import type { AgentConfigCreationOptions } from "agent-config-manager";
import { parseCliArgs, renderHelp } from "./cli-options";

type StartAgent = (options: AgentConfigCreationOptions) => Promise<void> | void;
type CheckConfig = (
  options: AgentConfigCreationOptions,
) => Promise<void> | void;

export type RunCliOptions = {
  argv?: string[];
  env?: Record<string, string | undefined>;
  startAgent: StartAgent;
  checkConfig?: CheckConfig;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
};

export const runCli = async ({
  argv = process.argv.slice(2),
  env = process.env,
  startAgent,
  checkConfig,
  stdout = console.log,
  stderr = console.error,
}: RunCliOptions) => {
  try {
    const parsed = parseCliArgs(argv, env);

    if (parsed.command === "help") {
      stdout(renderHelp());
      return 0;
    }

    if (parsed.command === "doctor") {
      if (!checkConfig) {
        throw new Error("Doctor command is not configured.");
      }
      try {
        await checkConfig(parsed.options);
        stdout("ADO config check passed.");
      } catch (error) {
        stderr(
          `ADO config check failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return 1;
      }
      return 0;
    }

    await startAgent(parsed.options);
    return 0;
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error));
    stderr("");
    stderr(renderHelp());
    return 1;
  }
};
