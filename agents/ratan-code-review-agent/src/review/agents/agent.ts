import type { LanguageModel } from "ai";
import { generateObject, generateText } from "ai";
import type { z } from "zod";
import type { RequestContext } from "../runtime";

type Instructions =
  | string
  | ((context: { requestContext?: RequestContext<any> }) => string);

export class ReviewAgent {
  constructor(
    private readonly options: {
      id: string;
      name: string;
      instructions: Instructions;
      model: LanguageModel;
      structuredOutput?: {
        schema: z.ZodType;
      };
    },
  ) {}

  get id() {
    return this.options.id;
  }

  async generate(
    prompt: string,
    options: { requestContext?: RequestContext<any> } = {},
  ): Promise<{ object?: unknown; text: string }> {
    const system =
      typeof this.options.instructions === "function"
        ? this.options.instructions({ requestContext: options.requestContext })
        : this.options.instructions;

    if (this.options.structuredOutput) {
      const result = await generateObject({
        model: this.options.model,
        system,
        prompt,
        schema: this.options.structuredOutput.schema,
      });

      return {
        object: result.object,
        text: JSON.stringify(result.object),
      };
    }

    const result = await generateText({
      model: this.options.model,
      system,
      prompt,
    });

    return {
      text: result.text,
    };
  }
}
