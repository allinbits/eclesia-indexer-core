import {
  describe, expect, it, vi,
} from "vitest";

import {
  RateLimiter,
} from "./rate-limit.js";
import {
  BatchingHttpClient,
} from "./transport.js";

const request = (id: string, method = "block") => ({
  jsonrpc: "2.0" as const,
  id,
  method,
  params: {
  },
});

/** A fetch that answers every request in the batch, optionally failing some by id */
const fakeFetch = (options: {
  status?: number
  failIds?: string[]
  calls: Array<unknown[]>
}) => vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body)) as Array<{
    id: string
    method: string
  }>;
  options.calls.push(body);
  const replies = body.map(r => (options.failIds?.includes(r.id)
    ? {
      jsonrpc: "2.0",
      id: r.id,
      error: {
        code: -32603,
        message: "height not available",
      },
    }
    : {
      jsonrpc: "2.0",
      id: r.id,
      result: {
        method: r.method,
      },
    }));
  return new Response(JSON.stringify(replies), {
    status: options.status ?? 200,
  });
}) as unknown as typeof fetch;

describe("BatchingHttpClient", () => {
  it("packs concurrent calls into one HTTP request and maps replies by id", async () => {
    const calls: Array<unknown[]> = [];
    const client = new BatchingHttpClient("http://node", {
    }, {
      sizeLimit: 10,
      dispatchIntervalMs: 5,
    }, null, fakeFetch({
      calls,
    }));
    const replies = await Promise.all([client.execute(request("1")), client.execute(request("2", "block_results")), client.execute(request("3"))]);
    expect(calls.length).toBe(1);
    expect(calls[0].length).toBe(3);
    expect((replies[1] as unknown as {
      result: {
        method: string
      }
    }).result.method).toBe("block_results");
  });

  it("sends as soon as the size limit is reached and keeps the rest for the next batch", async () => {
    const calls: Array<unknown[]> = [];
    const client = new BatchingHttpClient("http://node", {
    }, {
      sizeLimit: 2,
      dispatchIntervalMs: 5,
    }, null, fakeFetch({
      calls,
    }));
    await Promise.all([1, 2, 3].map(i => client.execute(request(String(i)))));
    expect(calls.map(c => c.length)).toEqual([2, 1]);
  });

  it("rejects only the calls the node answered with an error", async () => {
    const calls: Array<unknown[]> = [];
    const client = new BatchingHttpClient("http://node", {
    }, {
      dispatchIntervalMs: 1,
    }, null, fakeFetch({
      calls,
      failIds: ["2"],
    }));
    const results = await Promise.allSettled([client.execute(request("1")), client.execute(request("2"))]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    expect((results[1] as PromiseRejectedResult).reason.message).toContain("height not available");
  });

  it("rejects every call of a failed HTTP request", async () => {
    const client = new BatchingHttpClient("http://node", {
    }, {
      dispatchIntervalMs: 1,
    }, null, fakeFetch({
      calls: [],
      status: 403,
    }));
    const results = await Promise.allSettled([client.execute(request("1")), client.execute(request("2"))]);
    expect(results.every(r => r.status === "rejected")).toBe(true);
    expect((results[0] as PromiseRejectedResult).reason.message).toBe("Bad status on response: 403");
  });

  it("paces HTTP requests, not the calls inside them, and sends custom headers", async () => {
    const calls: Array<unknown[]> = [];
    const fetchFn = fakeFetch({
      calls,
    });
    const limiter = new RateLimiter(50); // 20 ms between HTTP requests
    const client = new BatchingHttpClient("http://node", {
      "user-agent": "eclesia",
    }, {
      sizeLimit: 2,
      dispatchIntervalMs: 1,
    }, limiter, fetchFn);
    const t0 = Date.now();
    await Promise.all([1, 2, 3, 4, 5, 6].map(i => client.execute(request(String(i)))));
    expect(calls.length).toBe(3);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(35);
    const init = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["user-agent"]).toBe("eclesia");
  });

  it("rejects queued and new calls after disconnect", async () => {
    const client = new BatchingHttpClient("http://node", {
    }, {
      dispatchIntervalMs: 1000,
    }, null, fakeFetch({
      calls: [],
    }));
    const queued = client.execute(request("1"));
    client.disconnect();
    await expect(queued).rejects.toThrow("disconnected");
    await expect(client.execute(request("2"))).rejects.toThrow("disconnected");
  });
});
