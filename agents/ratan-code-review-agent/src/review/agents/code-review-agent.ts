import { ReviewAgent } from "./agent";
import z from "zod";
import { CodeReviewIssueSchema } from "../types";
import { structureOutputPrompt } from "../utils/structure-output-prompt";
import { openai } from "./openai-client";

const CodeReviewIssuesSchema = z.array(CodeReviewIssueSchema);

export const codeReviewAgent = new ReviewAgent({
  id: "codeReviewAgent",
  name: "Code Review Agent",
  instructions: `
  You are an expert software developer and architect. You are an expert in software reliability, security, scalability, and performance.

  ## Task

  Review the changes in <CODE_CHANGES> which contains the diff of the last commit in the pull request branch.
  Provide feedback using the defined json schema.

  ${structureOutputPrompt(CodeReviewIssuesSchema)}
  - If you find no issues, respond with empty array.
`,
  model: openai("gpt-5-mini"),
  structuredOutput: {
    schema: CodeReviewIssuesSchema,
  },
});
