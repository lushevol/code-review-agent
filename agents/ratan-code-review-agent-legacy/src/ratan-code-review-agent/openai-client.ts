import { createOpenAI } from "@ai-sdk/openai";

export const openai = createOpenAI({
  name: "openai",
  apiKey: process.env.OPENAI_API_KEY || "",
  baseURL: process.env.OPENAI_API_BASE_URL || "https://api.openai.com/v1",
});
