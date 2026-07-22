import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineStep, RequestContext, runSteps } from "./index";

describe("review runtime", () => {
  it("runs validated TypeScript steps with request context", async () => {
    const requestContext = new RequestContext<{ configSessionId: string }>();
    requestContext.set("configSessionId", "session-1");

    const first = defineStep({
      id: "first",
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.object({ value: z.string() }),
      execute: vi.fn(async ({ inputData, requestContext }) => ({
        value: inputData.value + requestContext.get("configSessionId"),
      })),
    });
    const second = defineStep({
      id: "second",
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.object({ value: z.string() }),
      execute: vi.fn(async ({ inputData }) => ({
        value: `${inputData.value}:done`,
      })),
    });

    const outputs: unknown[] = [];
    const result = await runSteps(
      [first, second],
      { value: "input-" },
      { requestContext, onStepComplete: (output) => outputs.push(output) },
    );

    expect(result).toEqual({ value: "input-session-1:done" });
    expect(outputs).toEqual([
      { stepId: "first", output: { value: "input-session-1" } },
      {
        stepId: "second",
        output: { value: "input-session-1:done" },
      },
    ]);
  });

  it("rejects invalid step input before execution", async () => {
    const execute = vi.fn(async () => ({ value: "unused" }));
    const step = defineStep({
      id: "validated",
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.object({ value: z.string() }),
      execute,
    });

    await expect(
      runSteps([step], { value: 42 }, { requestContext: new RequestContext() }),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects invalid step output", async () => {
    const step = defineStep({
      id: "validated",
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.object({ value: z.string() }),
      execute: vi.fn(async () => ({ value: 42 })),
    });

    await expect(
      runSteps([step], { value: "input" }, { requestContext: new RequestContext() }),
    ).rejects.toThrow();
  });
});
