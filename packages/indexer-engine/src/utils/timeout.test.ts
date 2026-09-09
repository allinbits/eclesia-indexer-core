import {
  afterEach, expect, test, vi,
} from "vitest";

import {
  retryDelay, withTimeout,
} from "./timeout";

afterEach(() => {
  vi.useRealTimers();
});

test("withTimeout resolves with the value and leaves no pending timer", async () => {
  vi.useFakeTimers();
  const result = await withTimeout(Promise.resolve(42), 1000, new Error("late"));
  expect(result).toBe(42);
  expect(vi.getTimerCount()).toBe(0);
});

test("withTimeout rejects with the given error when the timer wins", async () => {
  vi.useFakeTimers();
  const never = new Promise<number>(() => {});
  const pending = withTimeout(never, 1000, new Error("late"));
  const assertion = expect(pending).rejects.toThrow("late");
  await vi.advanceTimersByTimeAsync(1000);
  await assertion;
  expect(vi.getTimerCount()).toBe(0);
});

test("withTimeout propagates the inner rejection", async () => {
  vi.useFakeTimers();
  await expect(withTimeout(Promise.reject(new Error("inner")), 1000, new Error("late"))).rejects.toThrow("inner");
  expect(vi.getTimerCount()).toBe(0);
});

test("retryDelay doubles from the base and caps at the maximum", () => {
  expect([1, 2, 3, 4, 5, 6, 7, 8].map(n => retryDelay(n, 5000, 300000))).toEqual([5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000]);
  expect(retryDelay(0, 5000, 300000)).toBe(5000);
});
