import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

const openai = createOpenAI({
  name: "openai",
  apiKey: "",
  baseURL: "http://localhost:1218/v1",
});

const response = await generateText({
  model: openai("gpt-5-mini"),
  prompt: "Hello, how are you?",
});

console.log("Response:", response.text);
