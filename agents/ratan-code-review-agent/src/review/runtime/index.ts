import type { z } from "zod";

export class RequestContext<T extends Record<string, unknown> = Record<string, unknown>> {
  private readonly values = new Map<keyof T, T[keyof T]>();

  set<K extends keyof T>(key: K, value: T[K]) {
    this.values.set(key, value);
  }

  get<K extends keyof T>(key: K): T[K] | undefined {
    return this.values.get(key) as T[K] | undefined;
  }
}

export interface StepExecutionContext<TInput = any> {
  inputData: TInput;
  requestContext: RequestContext<any>;
}

export interface ReviewStep<TInput = any, TOutput = any> {
  id: string;
  description?: string;
  inputSchema?: z.ZodType<TInput>;
  outputSchema?: z.ZodType<TOutput>;
  execute(context: StepExecutionContext<TInput>): Promise<TOutput>;
}

export function defineStep<TInput = any, TOutput = any>(
  step: ReviewStep<TInput, TOutput> & Record<string, unknown>,
): ReviewStep<TInput, TOutput> {
  return step;
}

export async function runSteps(
  steps: ReviewStep[],
  inputData: unknown,
  options: {
    requestContext: RequestContext<any>;
    onStepComplete?: (event: { stepId: string; output: unknown }) => void;
  },
) {
  let current = inputData;
  for (const step of steps) {
    step.inputSchema?.parse(current);
    const output = await step.execute({
      inputData: current,
      requestContext: options.requestContext,
    });
    step.outputSchema?.parse(output);
    current = output;
    options.onStepComplete?.({ stepId: step.id, output: current });
  }

  return current;
}
