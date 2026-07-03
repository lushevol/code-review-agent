import { Agent } from "@mastra/core/agent";
import z from "zod";
import { CodeReviewIssueClassificationSchema } from "../types";
import { structureOutputPrompt } from "../utils/structure-output-prompt";
import { openai } from "./openai-client";

const CodeReviewIssueClassificationsSchema = z.array(
  CodeReviewIssueClassificationSchema,
);

export const codeReviewIssueClassificationAgent = new Agent({
  id: "codeReviewIssueClassificationAgent",
  name: "Code Review Issue Classification Agent",
  instructions: `
  You are an expert software engineer with extensive experience in code review and issue classification. Your task is to classify the following code review issues into appropriate categories and sub-categories based on their characteristics.

  ${structureOutputPrompt(CodeReviewIssueClassificationsSchema)}
`,
  model: openai("gpt-5-mini"),
  defaultOptions: {
    structuredOutput: {
      schema: CodeReviewIssueClassificationsSchema,
    },
  },
});
