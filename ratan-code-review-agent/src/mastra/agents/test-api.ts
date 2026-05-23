import { createOpenAI } from "@ai-sdk/openai";

const openai = createOpenAI({
  name: "openai",
  apiKey: "",
  baseURL: "http://localhost:1218/v1",
});

openai("gpt-5-mini")
  .doGenerate({
    inputFormat: "prompt",
    mode: {
      type: "regular",
    },
    prompt: [
      {
        role: "system",
        content: "Hello, how are you?",
      },
    ],
  })
  .then((res) => {
    console.log("Response:", res.text);
  });
