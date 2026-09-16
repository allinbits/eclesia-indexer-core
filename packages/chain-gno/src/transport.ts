import type {
  RpcClient,
} from "@gnolang/tm2-rpc";

import type {
  RateLimiter,
} from "./rate-limit.js";

type JsonRpcRequest = Parameters<RpcClient["execute"]>[0];
type JsonRpcSuccessResponse = Awaited<ReturnType<RpcClient["execute"]>>;

/** Options for the batching HTTP transport */
export type BatchOptions = {
  sizeLimit?: number // Most JSON-RPC calls sent in one HTTP request (default: 20)
  dispatchIntervalMs?: number // How long a call waits for company before the batch is sent (default: 20)
};

type Pending = {
  request: JsonRpcRequest
  resolve: (reply: JsonRpcSuccessResponse) => void
  reject: (error: Error) => void
};

/**
 * HTTP transport that packs concurrent JSON-RPC calls into one request each (Tendermint2
 * accepts JSON-RPC batches), so a rate limiter that counts HTTP requests, as public endpoints
 * do, sees a fraction of the calls. The optional limiter paces the HTTP requests, not the
 * calls inside them. Every call in a failed HTTP request is rejected, so the engine's recovery
 * sees the failure as it would with single requests.
 */
export class BatchingHttpClient implements RpcClient {
  private readonly sizeLimit: number;

  private readonly dispatchIntervalMs: number;

  private queue: Pending[] = [];

  private timer: NodeJS.Timeout | null = null;

  private closed = false;

  constructor(
    private readonly url: string,
    private readonly headers: Record<string, string>,
    options: BatchOptions = {
    },
    private readonly limiter: RateLimiter | null = null,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.sizeLimit = Math.max(1, options.sizeLimit ?? 20);
    this.dispatchIntervalMs = Math.max(0, options.dispatchIntervalMs ?? 20);
  }

  execute(request: JsonRpcRequest): Promise<JsonRpcSuccessResponse> {
    return new Promise<JsonRpcSuccessResponse>((resolve, reject) => {
      if (this.closed) {
        reject(new Error("RPC client is disconnected"));
        return;
      }
      this.queue.push({
        request,
        resolve,
        reject,
      });
      if (this.queue.length >= this.sizeLimit) {
        this.flush();
      }
      else if (!this.timer) {
        this.timer = setTimeout(() => this.flush(), this.dispatchIntervalMs);
      }
    });
  }

  disconnect(): void {
    this.closed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const pending = this.queue;
    this.queue = [];
    for (const item of pending) {
      item.reject(new Error("RPC client is disconnected"));
    }
  }

  /** Sends the next batch; schedules another round when calls are still waiting */
  private flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch = this.queue.splice(0, this.sizeLimit);
    if (batch.length === 0) {
      return;
    }
    const send = () => this.post(batch);
    (this.limiter ? this.limiter.schedule(send) : send()).catch((error: unknown) => {
      const failure = error instanceof Error ? error : new Error(String(error));
      for (const item of batch) {
        item.reject(failure);
      }
    });
    if (this.queue.length > 0 && !this.timer) {
      this.timer = setTimeout(() => this.flush(), this.dispatchIntervalMs);
    }
  }

  private async post(batch: Pending[]): Promise<void> {
    const response = await this.fetchFn(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.headers,
      },
      body: JSON.stringify(batch.map(item => item.request)),
    });
    if (response.status >= 400) {
      throw new Error("Bad status on response: " + response.status);
    }
    const parsed = await response.json() as unknown;
    const replies = new Map<string, {
      id: string | number
      result?: unknown
      error?: {
        code: number
        message: string
        data?: unknown
      }
    }>();
    for (const reply of Array.isArray(parsed) ? parsed : [parsed]) {
      replies.set(String(reply.id), reply);
    }
    for (const item of batch) {
      const reply = replies.get(String(item.request.id));
      if (!reply) {
        item.reject(new Error("No response for JSON-RPC request " + String(item.request.id)));
      }
      else if (reply.error) {
        item.reject(new Error("JSON-RPC error " + reply.error.code + ": " + reply.error.message + (reply.error.data !== undefined ? " " + JSON.stringify(reply.error.data) : "")));
      }
      else {
        item.resolve(reply as JsonRpcSuccessResponse);
      }
    }
  }
}
