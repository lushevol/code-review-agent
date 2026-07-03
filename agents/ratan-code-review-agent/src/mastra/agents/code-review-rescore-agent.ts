import { Agent } from "@mastra/core/agent";
import z from "zod";
import { CodeReviewRescoreSchema } from "../types";
import { structureOutputPrompt } from "../utils/structure-output-prompt";
import { openai } from "./openai-client";

const CodeReviewRescoresSchema = z.array(CodeReviewRescoreSchema);

export const codeReviewRescoreAgent = new Agent({
  id: "codeReviewRescoreAgent",
  name: "Code Review Rescore Agent",
  instructions: `
  You got a list of issues from prior analysis. Rescore issues on their confidence_score base on principles below. Issues are in <ISSUES> tag.

  If issues not follows the principles, reduce the confidence_score.

  ${structureOutputPrompt(CodeReviewRescoresSchema)}
`,
  model: openai("gpt-5-mini"),
  defaultOptions: {
    structuredOutput: {
      schema: CodeReviewRescoresSchema,
    },
  },
});
