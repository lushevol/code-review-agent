import { createStep } from "@mastra/core";
import z from "zod";
import { extractAgentConfig } from "../../../bootstrap/session";
import { type CommonRuntimeContext, PullRequestSchema } from "../../types";
import { MAX_CHARACTER } from "../../utils/const";

const CodeSummaryInputSchema = z.object({
  prDetails: PullRequestSchema,
});

const CodeSummaryResultSchema = z.object({
  codeChangeSummary: z.string().describe("The summary of the code changes"),
});

export const codeSummary = createStep({
  id: "code-summary",
  description: "Summarizes code changes",
  inputSchema: CodeSummaryInputSchema,
  outputSchema: CodeSummaryResultSchema,
  execute: async ({ inputData, mastra, runtimeContext }) => {
    if (!inputData) {
      throw new Error("Input data not found");
    }
    let {
      prDetails: { codeDiffs },
    } = inputData;

    let warning = "";
    if (codeDiffs.length > MAX_CHARACTER) {
      codeDiffs = codeDiffs.slice(0, MAX_CHARACTER);
      warning =
        "[Warning: The code diff is too large, only the first part is included.]\n";
    }
    if (codeDiffs.trim() === "") {
      return {
        codeChangeSummary: "No code changes detected.",
      };
    }

    const agentConfig = extractAgentConfig(
      runtimeContext as unknown as CommonRuntimeContext,
    );

    const instructionsPrompt = await agentConfig.buildPrompt("summary");

    const prompt = `
      ${instructionsPrompt}

      ## Code Changes

      <CODE_CHANGES>
      ${codeDiffs}
      </CODE_CHANGES>
    `;

    const codeChangeSummaryAgent = mastra.getAgent("codeChangeSummaryAgent");
    const output = await codeChangeSummaryAgent.generateLegacy(prompt);

    return {
      codeChangeSummary: warning ? `${warning}\n${output.text}` : output.text,
    };
  },
});
