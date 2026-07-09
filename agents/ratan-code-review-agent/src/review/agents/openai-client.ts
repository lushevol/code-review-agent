import { createOpenAI } from "@ai-sdk/openai";

let _client: ReturnType<typeof createOpenAI> | null = null;

function getClient() {
  if (!_client) {
    _client = createOpenAI({
      name: "openai",
      apiKey: process.env.OPENAI_API_KEY ?? "",
      baseURL: process.env.OPENAI_BASE_URL ?? "http://localhost:1218/v1",
    });
  }
  return _client;
}

export const openai = (model: string) => getClient()(model);
