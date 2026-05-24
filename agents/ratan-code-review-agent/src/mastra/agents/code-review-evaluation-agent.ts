import { Agent } from "@mastra/core/agent";
import type { RequestContext } from "@mastra/core/request";
import { type AIJudgeInput, aiJudgeOutputSchema } from "../../evaluation/type";
import { structureOutputPrompt } from "../utils/structure-output-prompt";
import { openai } from "./openai-client";

type EvaluationRequestContext = RequestContext<AIJudgeInput>;

export const codeReviewEvaluationJudgeAgent = new Agent({
  name: "Code Review Evaluation Judge Agent",
  instructions: ({ requestContext }) => `
  You are an expert Senior Software Engineer acting as a QA Judge for an AI Code Reviewer.
  
  CONTEXT:
  We have a code snippet and a list of "Ground Truth" (Expected) issues.
  The AI Code Reviewer has identified an issue.
  
  CODE SNIPPET:
  \`\`\`
  ${(<EvaluationRequestContext>requestContext).get("input").codeChange.changes}
  \`\`\`
  
  GROUND TRUTH ISSUES: 
  ${JSON.stringify((<EvaluationRequestContext>requestContext).get("expectedOutput").issues, null, 2)}
  
  ISSUE FOUND BY AI:
  ${JSON.stringify((<EvaluationRequestContext>requestContext).get("actualIssue"), null, 2)}
  
  METADATA:
  Did this issue fuzzy-match a location in the Ground Truth? ${(<EvaluationRequestContext>requestContext).get("isMatchedExpectation") ? "YES" : "NO"}
  
  YOUR TASK:
  1. **False Positive Check**: 
      - If the AI found an issue NOT in the Ground Truth, is it a valid issue (just undocumented) or a hallucination?
      - If incorrect/irrelevant -> "is_false_positive": true.
      - If valid (even if new) -> "is_false_positive": false.
      
  2. **Suggestion Quality**: 
      - Rate the helpfulness of the AI's 'suggestion' field (1-5).
      - 1=Nonsense, 3=Generic, 5=Perfect fix.

  ${structureOutputPrompt(aiJudgeOutputSchema)}
`,
  model: openai("gpt-5-mini"),
  defaultGenerateOptions: {
    structuredOutput: {
      schema: aiJudgeOutputSchema,
    },
  },
});
