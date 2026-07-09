import { describe, it, expect, vi } from "vitest";
import { withRetry } from "./retry";

describe("withRetry", () => {
  it("returns the result of a successful call immediately", async () => {
    const fn = vi.fn().mockResolvedValue("success");
    const result = await withRetry(fn, { maxAttempts: 3 });
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries after a transient failure and succeeds", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("transient error"))
      .mockResolvedValueOnce("recovered");

    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 });
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws the last error after exhausting all attempts", async () => {
    const error = new Error("persistent failure");
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 })).rejects.toThrow(
      "persistent failure",
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("calls onRetry callback with attempt number and error", async () => {
    const error = new Error("fail");
    const fn = vi.fn().mockRejectedValue(error);
    const onRetry = vi.fn();

    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 10, onRetry }),
    ).rejects.toThrow("fail");

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, error);
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, error);
  });

  it("increases delay between retries", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const error = new Error("fail");
    const fn = vi.fn().mockRejectedValue(error);

    const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 100 });
    // Pre-register catch to avoid unhandled rejection warnings with fake timers
    promise.catch(() => {});

    // Allow all timers to run
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow("fail");
    expect(fn).toHaveBeenCalledTimes(3);

    // First retry delay ~100 + jitter, second ~200 + jitter
    expect(setTimeoutSpy).toHaveBeenCalledTimes(2);

    // Check that the first delay is >= 100 and < 1100 (100 + max jitter)
    const firstDelay = setTimeoutSpy.mock.calls[0][1] as number;
    expect(firstDelay).toBeGreaterThanOrEqual(100);
    expect(firstDelay).toBeLessThan(1100);

    // Check that the second delay is >= 200 and < 1200 (200 + max jitter)
    const secondDelay = setTimeoutSpy.mock.calls[1][1] as number;
    expect(secondDelay).toBeGreaterThanOrEqual(200);
    expect(secondDelay).toBeLessThan(1200);

    setTimeoutSpy.mockRestore();
    vi.useRealTimers();
  });

  it("wraps non-Error thrown values in Error", async () => {
    const fn = vi.fn().mockRejectedValue("string error");

    await expect(withRetry(fn, { maxAttempts: 1 })).rejects.toThrow("string error");
  });

  it("respects maxDelayMs cap", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const error = new Error("fail");
    const fn = vi.fn().mockRejectedValue(error);

    const promise = withRetry(fn, { maxAttempts: 5, baseDelayMs: 10000, maxDelayMs: 15000 });
    // Pre-register catch to avoid unhandled rejection warnings with fake timers
    promise.catch(() => {});

    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow("fail");

    // With baseDelayMs=10000, delays would be 10000, 20000, 40000, 80000
    // but maxDelayMs=15000 caps them. First attempt uses base delay.
    // i=0: min(10000*2^0=10000, 15000) + jitter = 10000 + jitter
    const firstDelay = setTimeoutSpy.mock.calls[0][1] as number;
    expect(firstDelay).toBeGreaterThanOrEqual(10000);
    expect(firstDelay).toBeLessThan(11000);
    // i=1: min(10000*2^1=20000, 15000) + jitter = 15000 + jitter
    const secondDelay = setTimeoutSpy.mock.calls[1][1] as number;
    expect(secondDelay).toBeGreaterThanOrEqual(15000);
    expect(secondDelay).toBeLessThan(16000);
    // i=2: min(10000*2^2=40000, 15000) + jitter = 15000 + jitter
    const thirdDelay = setTimeoutSpy.mock.calls[2][1] as number;
    expect(thirdDelay).toBeGreaterThanOrEqual(15000);
    expect(thirdDelay).toBeLessThan(16000);
    // i=3: min(10000*2^3=80000, 15000) + jitter = 15000 + jitter
    const fourthDelay = setTimeoutSpy.mock.calls[3][1] as number;
    expect(fourthDelay).toBeGreaterThanOrEqual(15000);
    expect(fourthDelay).toBeLessThan(16000);

    setTimeoutSpy.mockRestore();
    vi.useRealTimers();
  });
});
