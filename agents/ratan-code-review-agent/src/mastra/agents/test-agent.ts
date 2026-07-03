import { Agent } from "@mastra/core/agent";
import z from "zod";
import { openai } from "./openai-client";

export const testSchema = z.object({
  message: z.string(),
  additionalData: z.any().optional(),
});

export const testAgent = new Agent({
  id: "testAgent",
  name: "Test Agent",
  instructions: `You are a test agent for demonstration purposes. Generate a response with following schema,
  
  ${JSON.stringify(z.toJSONSchema(testSchema), null, 4)}`,
  model: openai("gpt-5-mini"),
  defaultOptions: {
    structuredOutput: {
      schema: testSchema,
    },
  },
});
