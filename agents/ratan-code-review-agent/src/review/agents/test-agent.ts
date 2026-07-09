import { ReviewAgent } from "./agent";
import z from "zod";
import { openai } from "./openai-client";

export const testSchema = z.object({
  message: z.string(),
  additionalData: z.any().optional(),
});

export const testAgent = new ReviewAgent({
  id: "testAgent",
  name: "Test Agent",
  instructions: `You are a test agent for demonstration purposes. Generate a response with following schema,
  
  ${JSON.stringify(z.toJSONSchema(testSchema), null, 4)}`,
  model: openai("gpt-5-mini"),
  structuredOutput: {
    schema: testSchema,
  },
});
