import {
  describe, expect, it, vi,
} from "vitest";

import {
  RateLimiter, throttledRpcClient,
} from "./rate-limit.js";

describe("RateLimiter", () => {
  it("spaces calls one interval apart, in order", async () => {
    const limiter = new RateLimiter(50); // 20 ms apart
    const started: number[] = [];
    const t0 = Date.now();
    await Promise.all([1, 2, 3, 4, 5].map(i => limiter.schedule(async () => {
      started.push(Date.now() - t0);
      return i;
    })));
    expect(started.length).toBe(5);
    // Five calls need four intervals: at least 80 ms from first to last, never sooner than the slot
    expect(started[4] - started[0]).toBeGreaterThanOrEqual(75);
    for (let i = 1; i < started.length; i++) {
      expect(started[i]).toBeGreaterThanOrEqual(started[i - 1]);
    }
  });

  it("does not delay a call when the previous slot has passed", async () => {
    const limiter = new RateLimiter(10);
    const t0 = Date.now();
    await limiter.schedule(async () => 1);
    await new Promise(resolve => setTimeout(resolve, 120));
    const before = Date.now();
    await limiter.schedule(async () => 2);
    expect(Date.now() - before).toBeLessThan(30);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(120);
  });

  it("rejects a non-positive rate", () => {
    expect(() => new RateLimiter(0)).toThrow("positive");
  });
});

describe("throttledRpcClient", () => {
  it("routes execute through the limiter and forwards disconnect", async () => {
    const limiter = new RateLimiter(1000);
    const schedule = vi.spyOn(limiter, "schedule");
    const inner = {
      execute: vi.fn(async (request: unknown) => ({
        jsonrpc: "2.0" as const,
        id: "1",
        result: request,
      })),
      disconnect: vi.fn(),
    };
    const client = throttledRpcClient(inner as never, limiter);
    const reply = await client.execute({
      jsonrpc: "2.0",
      id: "1",
      method: "status",
      params: {
      },
    } as never);
    expect((reply as {
      result: {
        method: string
      }
    }).result.method).toBe("status");
    expect(schedule).toHaveBeenCalledTimes(1);
    client.disconnect();
    expect(inner.disconnect).toHaveBeenCalledTimes(1);
  });
});
