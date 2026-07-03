import { Agent } from "@mastra/core/agent";
import { openai } from "./openai-client";

export const codeChangeSummaryAgent = new Agent({
  id: "codeChangeSummaryAgent",
  name: "Code Change Summary Agent",
  instructions: `You are an expert software developer, architect and an expert at writing English technical documentation.`,
  model: openai("gpt-5-mini"),
});
