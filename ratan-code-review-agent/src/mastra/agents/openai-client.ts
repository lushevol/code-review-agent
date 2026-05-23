import { createOpenAI } from "@ai-sdk/openai";

export const openai = createOpenAI({
  name: "openai",
  apiKey: "",
  baseURL: "http://localhost:1218/v1",
});
