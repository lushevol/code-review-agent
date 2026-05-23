import { createScorer } from "@mastra/core/scores";
import { openai } from "../agents/openai-client";
import { CodeReviewRescoreSchema } from "../types";

const codeReviewScorer = createScorer({
  name: "Code Review Scorer",
  description: "Scores code review issues based on relation to prompts.",
  judge: {
    model: openai("gpt-5-mini"),
    instructions: `
  You got a list of issues from prior analysis. Rescore issues on their confidence_score base on principles below. Issues are in <ISSUES> tag.

  If issues not follows the principles, reduce the confidence_score.
        `,
  },
})
  .preprocess(async ({ results }) => {})
  .analyze({
    description:
      "Analyze the code review issues and their relevance to the prompt.",
    outputSchema: CodeReviewRescoreSchema,
    createPrompt({ run }) {
      return ``;
    },
  })
  .generateScore({})
  .generateReason({});
