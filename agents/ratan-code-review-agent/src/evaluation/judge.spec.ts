import { describe, expect, it, vi } from "vitest";
import { LlmEvaluationJudge } from "./judge";

describe("LlmEvaluationJudge", () => {
  it("uses the configured OpenAI-compatible endpoint for qualitative scoring", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        isFalsePositive: false,
        suggestionQuality: 4,
        reasoning: "The fix is concrete and preserves validation.",
      }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const judge = new LlmEvaluationJudge({
      url: "https://llm.example/v1",
      token: "secret",
      model: "judge-model",
    }, fetcher as typeof fetch);

    const result = await judge.evaluate({
      code: "const value = parse(input);",
      expectedFindings: [],
      actualFinding: {
        filePath: "src/file.ts",
        lineStart: 1,
        lineEnd: 1,
        category: "bug",
        severity: "high",
        title: "Validate input",
        description: "Input is trusted.",
        remediation: "Add schema validation.",
      },
      matchedExpectation: false,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://llm.example/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toEqual({
      isFalsePositive: false,
      suggestionQuality: 4,
      reasoning: "The fix is concrete and preserves validation.",
    });
  });
});
