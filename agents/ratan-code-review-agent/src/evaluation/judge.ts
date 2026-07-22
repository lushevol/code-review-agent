import { z } from "zod";
import type { GoldenActualFinding, GoldenTestCase } from "./golden-evaluator";

const QualitativeJudgementSchema = z.object({
  isFalsePositive: z.boolean(),
  suggestionQuality: z.number().min(1).max(5),
  reasoning: z.string().min(1),
});

export type QualitativeJudgement = z.infer<typeof QualitativeJudgementSchema>;

export interface EvaluationJudgeInput {
  code: string;
  expectedFindings: GoldenTestCase["expectedFindings"];
  actualFinding: GoldenActualFinding;
  matchedExpectation: boolean;
}

export interface EvaluationJudge {
  evaluate(input: EvaluationJudgeInput): Promise<QualitativeJudgement>;
}

export class LlmEvaluationJudge implements EvaluationJudge {
  constructor(
    private readonly llm: {
      url: string;
      token: string;
      model: string;
      protocol?: "anthropic" | "openai" | "openai-responses";
    },
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async evaluate(input: EvaluationJudgeInput): Promise<QualitativeJudgement> {
    const prompt = [
      "You are evaluating an AI code-review finding against a synthetic golden case.",
      "Decide whether the finding is a false positive and score its suggested fix from 1 to 5.",
      "Return JSON only with isFalsePositive, suggestionQuality, and reasoning.",
      `Matched deterministic expectation: ${input.matchedExpectation}`,
      `Changed code:\n${input.code}`,
      `Expected findings:\n${JSON.stringify(input.expectedFindings)}`,
      `Actual finding:\n${JSON.stringify(input.actualFinding)}`,
    ].join("\n\n");
    const response = this.llm.protocol === "anthropic"
      ? await this.callAnthropic(prompt)
      : await this.callOpenAi(prompt);
    return QualitativeJudgementSchema.parse(JSON.parse(extractJson(response)));
  }

  private async callOpenAi(prompt: string): Promise<string> {
    const response = await this.fetcher(endpoint(this.llm.url, "chat/completions"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.llm.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.llm.model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0,
      }),
    });
    if (!response.ok) throw new Error(`Evaluation judge failed with HTTP ${response.status}`);
    const body = await response.json() as any;
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("Evaluation judge returned no content");
    return content;
  }

  private async callAnthropic(prompt: string): Promise<string> {
    const response = await this.fetcher(endpoint(this.llm.url, "v1/messages"), {
      method: "POST",
      headers: {
        "x-api-key": this.llm.token,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.llm.model,
        max_tokens: 1024,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) throw new Error(`Evaluation judge failed with HTTP ${response.status}`);
    const body = await response.json() as any;
    const content = body.content?.find((item: any) => item.type === "text")?.text;
    if (typeof content !== "string") throw new Error("Evaluation judge returned no content");
    return content;
  }
}

function endpoint(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/$/, "")}/${suffix}`;
}

function extractJson(content: string): string {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Evaluation judge returned invalid JSON");
  return match[0];
}
