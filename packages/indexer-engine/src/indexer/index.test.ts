import {
  QueryValidatorsRequest, QueryValidatorsResponse,
} from "cosmjs-types/cosmos/staking/v1beta1/query.js";
import {
  afterEach, describe, expect, it, vi,
} from "vitest";

import {
  RPCError,
} from "../errors/index.js";
import {
  EclesiaIndexerConfig,
} from "../types/index.js";
import {
  defaultIndexerConfig, EcleciaIndexer, EclesiaIndexer,
} from "./index";

/**
 * Unit tests for the live block path and lifecycle of EclesiaIndexer.
 * The RPC clients are stubbed; the health and metrics servers are disabled.
 */

const makeIndexer = (overrides: Partial<EclesiaIndexerConfig> = {
}) => new EclesiaIndexer({
  batchSize: 5,
  modules: [],
  getNextHeight: () => 1,
  logLevel: "error",
  rpcUrl: "http://localhost:26657",
  shouldProcessGenesis: async () => false,
  usePolling: true,
  pollingInterval: 1000,
  minimal: true,
  enableHealthcheck: false,
  enablePrometheus: false,
  beginTransaction: async () => {},
  endTransaction: async () => {},
  ...overrides,
});

const stubClient = () => {
  const block = vi.fn(async (height: number) => ({
    block: {
      header: {
        height,
      },
    },
  }));
  const blockResults = vi.fn(async (height: number) => ({
    height,
  }));
  const status = vi.fn(async () => ({
    syncInfo: {
      latestBlockHeight: 100,
    },
  }));
  return {
    block,
    blockResults,
    status,
    disconnect: vi.fn(),
  };
};

afterEach(() => {
  vi.useRealTimers();
});

describe("newBlockReceived", () => {
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const live = (indexer: EclesiaIndexer, latest: number) => {
    const client = stubClient();
    indexer.client = client as never;
    indexer.blockClient = client as never;
    indexer["started"] = true;
    indexer["latestHeight"] = latest;
    indexer["nextFetchHeight"] = latest + 1;
    indexer["blockQueue"].setSynced();
    return client;
  };

  it("fetches every height between the last seen one and the announced one", async () => {
    const indexer = makeIndexer();
    const client = live(indexer, 100);

    indexer["newBlockReceived"](103);
    await settle();

    expect(client.block.mock.calls.map(call => call[0])).toEqual([101, 102, 103]);
    expect(indexer["latestHeight"]).toBe(103);
    expect(indexer["nextFetchHeight"]).toBe(104);
    // one sentinel slot plus the three fetches
    expect(indexer["blockQueue"].size()).toBe(4);
    await indexer.stop();
  });

  it("ignores heights at or below the last seen one", async () => {
    const indexer = makeIndexer();
    const client = live(indexer, 100);

    indexer["newBlockReceived"](100);
    indexer["newBlockReceived"](99);
    await settle();

    expect(client.block).not.toHaveBeenCalled();
    expect(indexer["latestHeight"]).toBe(100);
    await indexer.stop();
  });

  it("only moves the target while a fetcher is already running", async () => {
    const indexer = makeIndexer();
    const client = live(indexer, 100);
    indexer["fetcherRunning"] = true;
    indexer["fetcherGeneration"] = indexer["runGeneration"];

    indexer["newBlockReceived"](105);
    await settle();

    expect(client.block).not.toHaveBeenCalled();
    expect(indexer["latestHeight"]).toBe(105);
    indexer["fetcherRunning"] = false;
    await indexer.stop();
  });

  it("waits for queue space instead of overwriting or restarting", async () => {
    const indexer = makeIndexer({
      batchSize: 3,
    });
    const client = live(indexer, 100);

    indexer["newBlockReceived"](103);
    await settle();

    // two real slots: the third fetch waits
    expect(client.block.mock.calls.map(call => call[0])).toEqual([101, 102]);
    expect(indexer["tryToRecover"]).toBe(false);

    await indexer["blockQueue"].dequeue();
    await settle();
    expect(client.block.mock.calls.map(call => call[0])).toEqual([101, 102, 103]);
    expect(indexer["nextFetchHeight"]).toBe(104);
    await indexer.stop();
  });
});

describe("configuration", () => {
  it("does not let an explicit undefined override a default", async () => {
    const indexer = makeIndexer({
      minimal: undefined,
      pollingInterval: undefined,
    });
    expect(indexer["config"].minimal).toBe(defaultIndexerConfig.minimal);
    expect(indexer["config"].pollingInterval).toBe(defaultIndexerConfig.pollingInterval);
    await indexer.stop();
  });

  it("switches an HTTP endpoint to polling because it cannot subscribe", async () => {
    const indexer = makeIndexer({
      usePolling: false,
      rpcUrl: "https://rpc.example.com",
    });
    expect(indexer["config"].usePolling).toBe(true);
    const ws = makeIndexer({
      usePolling: false,
      rpcUrl: "wss://rpc.example.com/websocket",
    });
    expect(ws["config"].usePolling).toBe(false);
    await indexer.stop();
    await ws.stop();
  });
});

describe("callABCI", () => {
  it("throws on a non-zero ABCI code instead of returning empty bytes", async () => {
    const indexer = makeIndexer();
    const client = stubClient();
    (client as unknown as {
      abciQuery: unknown
    }).abciQuery = vi.fn(async () => ({
      code: 18,
      log: "height 5 is not available, lowest height is 100",
      value: new Uint8Array(),
    }));
    indexer.client = client as never;

    const failure = await indexer.callABCI("/cosmos.staking.v1beta1.Query/Validators", new Uint8Array(), 5).catch(e => e);
    expect(failure).toBeInstanceOf(RPCError);
    expect(failure.message).toContain("code 18");
    // The chain's answer travels with the error, so a module can act on the code instead of the message
    expect(failure.abciCode).toBe(18);
    expect(failure.abciLog).toBe("height 5 is not available, lowest height is 100");
    expect(failure.height).toBe(5);
    // an answered query is not an outage: no recovery for ad-hoc callers
    expect(indexer["tryToRecover"]).toBe(false);
    await indexer.stop();
  });

  it("leaves abciCode unset when the RPC cannot be reached", async () => {
    const indexer = makeIndexer();
    const client = stubClient();
    (client as unknown as {
      abciQuery: unknown
    }).abciQuery = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    indexer.client = client as never;

    const failure = await indexer.callABCI("/x", new Uint8Array()).catch(e => e);
    expect(failure).toBeInstanceOf(RPCError);
    expect(failure.abciCode).toBeUndefined();
    await indexer.stop();
  });

  it("requests recovery when the RPC cannot answer at all", async () => {
    const indexer = makeIndexer();
    const client = stubClient();
    (client as unknown as {
      abciQuery: unknown
    }).abciQuery = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    indexer.client = client as never;

    await expect(indexer.callABCI("/x", new Uint8Array())).rejects.toThrow("RPC not responding");
    expect(indexer["tryToRecover"]).toBe(true);
    await indexer.stop();
  });

  it("follows pagination when fetching the validator set", async () => {
    const indexer = makeIndexer();
    const client = stubClient();
    const page = (names: string[], nextKey?: Uint8Array) => QueryValidatorsResponse.encode(QueryValidatorsResponse.fromPartial({
      validators: names.map(operatorAddress => ({
        operatorAddress,
      })),
      pagination: nextKey
        ? {
          nextKey,
          total: 0n,
        }
        : undefined,
    })).finish();
    const abciQuery = vi.fn(async (req: {
      data: Uint8Array
    }) => {
      const key = QueryValidatorsRequest.decode(req.data).pagination?.key ?? new Uint8Array();
      return {
        code: 0,
        value: key.length === 0 ? page(["v1", "v2"], new Uint8Array([1])) : page(["v3"]),
      };
    });
    (client as unknown as {
      abciQuery: unknown
    }).abciQuery = abciQuery;
    indexer.blockClient = client as never;

    const merged = QueryValidatorsResponse.decode(await indexer["fetchValidatorSet"](42));

    expect(merged.validators.map(v => v.operatorAddress)).toEqual(["v1", "v2", "v3"]);
    expect(abciQuery).toHaveBeenCalledTimes(2);
    await indexer.stop();
  });
});

describe("asyncEmit", () => {
  it("runs handlers one at a time, in registration order", async () => {
    const indexer = makeIndexer();
    const order: string[] = [];
    indexer.on("log", async () => {
      order.push("first:start");
      await new Promise(resolve => setTimeout(resolve, 10));
      order.push("first:end");
    });
    indexer.on("log", async () => {
      order.push("second");
    });

    await indexer.asyncEmit("log", {
      type: "info",
      message: "x",
    });

    expect(order).toEqual(["first:start", "first:end", "second"]);
    await indexer.stop();
  });

  it("rejects with the handler's own error and stops at the first failure", async () => {
    const indexer = makeIndexer();
    const second = vi.fn();
    indexer.on("log", async () => {
      throw new Error("handler failed");
    });
    indexer.on("log", second);

    await expect(indexer.asyncEmit("log", {
      type: "info",
      message: "x",
    })).rejects.toThrow("handler failed");
    expect(second).not.toHaveBeenCalled();
    await indexer.stop();
  });

  it("resolves immediately when nothing handles the event", async () => {
    const indexer = makeIndexer();
    await expect(indexer.asyncEmit("log", {
      type: "info",
      message: "x",
    })).resolves.toBeUndefined();
    await indexer.stop();
  });
});

describe("subscription and chain checks", () => {
  it("requests recovery when the block subscription errors or closes", async () => {
    const indexer = makeIndexer();
    indexer["started"] = true;
    indexer["blockListener"].error(new Error("socket closed"));
    expect(indexer["tryToRecover"]).toBe(true);
    await indexer.stop();

    const other = makeIndexer();
    other["started"] = true;
    other["blockListener"].complete();
    expect(other["tryToRecover"]).toBe(true);
    await other.stop();
  });

  it("refuses a chain other than the configured one", async () => {
    const indexer = makeIndexer({
      chainId: "atomone-1",
    });
    expect(() => indexer["assertChainId"]("cosmoshub-4")).toThrow("chainId is configured as atomone-1");
    expect(() => indexer["assertChainId"]("atomone-1")).not.toThrow();
    const unpinned = makeIndexer();
    expect(() => unpinned["assertChainId"]("anything")).not.toThrow();
    await indexer.stop();
    await unpinned.stop();
  });
});

describe("polling and stop", () => {
  const settle = () => new Promise(resolve => setImmediate(resolve));

  it("keeps a single polling chain across restarts and clears it on stop", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
    });
    const indexer = makeIndexer();
    const client = stubClient();
    indexer.client = client as never;
    indexer["started"] = true;
    indexer["latestHeight"] = 100;

    indexer["startPolling"]();
    await settle();
    indexer["startPolling"]();
    await settle();

    expect(client.status).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);

    await indexer.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(client.disconnect).toHaveBeenCalled();
  });

  it("clears the inactivity timer armed by a received block", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
    });
    const indexer = makeIndexer();
    indexer.client = stubClient() as never;
    indexer["latestHeight"] = 100;
    // not started: the announcement arms the idle check but fetches nothing

    indexer["newBlockReceived"](101);
    expect(vi.getTimerCount()).toBe(1);

    await indexer.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("recovery and idle handling", () => {
  it("wakes a loop parked on an empty queue when recovery is requested", async () => {
    const indexer = makeIndexer();
    indexer["started"] = true;
    const parked = indexer["waitForBlockData"](new Promise<never>(() => {}));
    expect(indexer["blockWaiters"].size).toBe(1);

    indexer["requestRecovery"]("test");

    await expect(parked).rejects.toThrow("Recovery requested");
    expect(indexer["tryToRecover"]).toBe(true);
    expect(indexer["blockWaiters"].size).toBe(0);
    await indexer.stop();
  });

  it("forgets a wait as soon as its block arrives", async () => {
    const indexer = makeIndexer();
    indexer["started"] = true;
    for (let i = 0; i < 1000; i++) {
      await indexer["waitForBlockData"](Promise.resolve(["block", "results"]));
    }
    // Delivered waits must not pile up: an indexer runs for millions of blocks
    expect(indexer["blockWaiters"].size).toBe(0);
    await indexer.stop();
  });

  it("wakes a parked loop when the indexer is stopped", async () => {
    const indexer = makeIndexer();
    indexer["started"] = true;
    const parked = indexer["waitForBlockData"](new Promise<never>(() => {}));

    await indexer.stop();

    await expect(parked).rejects.toThrow("stopped while waiting");
    expect(indexer["blockWaiters"].size).toBe(0);
  });

  it("ignores recovery requests from a previous run", async () => {
    const indexer = makeIndexer();
    indexer["runGeneration"] = 3;

    indexer["requestRecovery"]("stale fetch", 2);

    expect(indexer["tryToRecover"]).toBe(false);
    await indexer.stop();
  });

  it("reports WAITING and re-arms when the chain is idle", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
    });
    const indexer = makeIndexer();
    const client = stubClient();
    indexer.client = client as never;
    indexer["started"] = true;
    indexer["latestHeight"] = 100;

    await indexer["checkLiveness"]();

    expect(indexer["tryToRecover"]).toBe(false);
    expect(indexer["healthCheck"].status).toBe("WAITING");
    expect(vi.getTimerCount()).toBe(1);
    await indexer.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("requests recovery when the chain moved on but nothing was announced", async () => {
    const indexer = makeIndexer();
    const client = stubClient();
    client.status.mockResolvedValue({
      syncInfo: {
        latestBlockHeight: 107,
      },
    });
    indexer.client = client as never;
    indexer["started"] = true;
    indexer["latestHeight"] = 100;

    await indexer["checkLiveness"]();

    expect(indexer["tryToRecover"]).toBe(true);
    await indexer.stop();
  });

  it("requests recovery when the RPC cannot be reached", async () => {
    const indexer = makeIndexer();
    const client = stubClient();
    client.status.mockRejectedValue(new Error("ECONNREFUSED"));
    indexer.client = client as never;
    indexer["started"] = true;
    indexer["latestHeight"] = 100;

    await indexer["checkLiveness"]();

    expect(indexer["tryToRecover"]).toBe(true);
    await indexer.stop();
  });
});

describe("stuck block policy", () => {
  it("treats repeated failures of the same block as stuck, and resets on a different height", async () => {
    const indexer = makeIndexer();
    for (let i = 0; i < 4; i++) {
      indexer["noteBlockFailure"](500);
    }
    expect(indexer["isStuck"]()).toBe(false);
    indexer["noteBlockFailure"](501);
    expect(indexer["isStuck"]()).toBe(false);
    for (let i = 0; i < 4; i++) {
      indexer["noteBlockFailure"](501);
    }
    expect(indexer["isStuck"]()).toBe(true);
    await indexer.stop();
  });

  it("honours maxFailuresPerBlock", async () => {
    const indexer = makeIndexer({
      maxFailuresPerBlock: 2,
    });
    indexer["noteBlockFailure"](7);
    indexer["noteBlockFailure"](7);
    expect(indexer["isStuck"]()).toBe(true);
    await indexer.stop();
  });
});

describe("compatibility", () => {
  it("keeps the misspelt class name as an alias", async () => {
    expect(EcleciaIndexer).toBe(EclesiaIndexer);
  });
});
