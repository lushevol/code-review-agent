import { Agent } from "@mastra/core/agent";
import { CodeReviewRescoreSchema } from "../types";
import { structureOutputPrompt } from "../utils/structure-output-prompt";
import { openai } from "./openai-client";

export const codeReviewRescoreAgent = new Agent({
  name: "Code Review Rescore Agent",
  instructions: `
  You got a list of issues from prior analysis. Rescore issues on their confidence_score base on principles below. Issues are in <ISSUES> tag.

  If issues not follows the principles, reduce the confidence_score.

  ${structureOutputPrompt(CodeReviewRescoreSchema)}
`,
  model: openai("gpt-5-mini"),
  defaultGenerateOptions: {
    // @ts-expect-error
    experimental_output: CodeReviewRescoreSchema,
  },
});
