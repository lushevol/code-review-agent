import { describe, expect, it, vi } from "vitest";
import { defineStep, RequestContext, runSteps } from "./index";

describe("review runtime", () => {
  it("runs plain TypeScript steps with request context and stored step results", async () => {
    const requestContext = new RequestContext<{ configSessionId: string }>();
    requestContext.set("configSessionId", "session-1");

    const first = defineStep({
      id: "first",
      execute: vi.fn(async ({ inputData, requestContext }) => ({
        value: inputData.value + requestContext.get("configSessionId"),
      })),
    });
    const second = defineStep({
      id: "second",
      execute: vi.fn(async ({ inputData, getStepResult }) => ({
        value: `${inputData.value}:${getStepResult("first").value}`,
      })),
    });

    const outputs: unknown[] = [];
    const result = await runSteps(
      [first, second],
      { value: "input-" },
      { requestContext, onStepComplete: (output) => outputs.push(output) },
    );

    expect(result).toEqual({ value: "input-session-1:input-session-1" });
    expect(outputs).toEqual([
      { stepId: "first", output: { value: "input-session-1" } },
      {
        stepId: "second",
        output: { value: "input-session-1:input-session-1" },
      },
    ]);
  });
});
