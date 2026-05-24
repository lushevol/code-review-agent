import z from "zod";

export const structureOutputPrompt = (schema: z.ZodSchema) => {
  return `
## Response Format

- You MUST respond in JSON format that adheres to the following schema:
\`\`\`jsonschema
${JSON.stringify(z.toJSONSchema(schema), null, 2)}
\`\`\`
- Ensure that your response is valid JSON. Do NOT include any explanations or additional text outside of the JSON structure.`;
};
