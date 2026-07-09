export class RequestContext<T extends Record<string, unknown> = Record<string, unknown>> {
  private readonly values = new Map<keyof T, T[keyof T]>();

  set<K extends keyof T>(key: K, value: T[K]) {
    this.values.set(key, value);
  }

  get<K extends keyof T>(key: K): T[K] | undefined {
    return this.values.get(key) as T[K] | undefined;
  }
}

export interface AgentRegistry {
  getAgent(id: string): {
    generate(prompt: string, options?: { requestContext?: RequestContext<any> }): Promise<{
      object?: unknown;
      text: string;
    }>;
  };
}

export interface StepExecutionContext<TInput = any> {
  inputData: TInput;
  requestContext: RequestContext<any>;
  agents: AgentRegistry;
  getStepResult: (id: string) => any;
}

export interface ReviewStep<TInput = any, TOutput = any> {
  id: string;
  description?: string;
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
    agents?: AgentRegistry;
    stepResults?: Map<string, unknown>;
    onStepComplete?: (event: { stepId: string; output: unknown }) => void;
  },
) {
  const stepResults = options.stepResults ?? new Map<string, unknown>();
  const agents =
    options.agents ??
    ({
      getAgent() {
        throw new Error("Agent registry is not configured");
      },
    } satisfies AgentRegistry);

  let current = inputData;
  for (const step of steps) {
    current = await step.execute({
      inputData: current,
      requestContext: options.requestContext,
      agents,
      getStepResult: (id) => stepResults.get(id) as any,
    });
    stepResults.set(step.id, current);
    options.onStepComplete?.({ stepId: step.id, output: current });
  }

  return current;
}
