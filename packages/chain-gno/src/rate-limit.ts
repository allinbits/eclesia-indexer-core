import type {
  RpcClient,
} from "@gnolang/tm2-rpc";

/**
 * Spaces calls evenly at a fixed rate: each call is scheduled one interval after the previous
 * one, so a public RPC behind a rate limiter sees a steady stream instead of bursts. Shared by
 * every client an adapter opens, since the limit is per endpoint, not per connection.
 */
export class RateLimiter {
  private readonly intervalMs: number;

  private nextSlot = 0;

  constructor(requestsPerSecond: number) {
    if (!(requestsPerSecond > 0)) {
      throw new Error("requestsPerSecond must be a positive number");
    }
    this.intervalMs = 1000 / requestsPerSecond;
  }

  /** Runs `fn` at the next free slot */
  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + this.intervalMs;
    if (slot > now) {
      await new Promise(resolve => setTimeout(resolve, slot - now));
    }
    return fn();
  }
}

/** Wraps a tm2-rpc transport so every JSON-RPC call goes through the limiter */
export function throttledRpcClient(client: RpcClient, limiter: RateLimiter): RpcClient {
  return {
    execute: request => limiter.schedule(() => client.execute(request)),
    disconnect: () => client.disconnect(),
  };
}
