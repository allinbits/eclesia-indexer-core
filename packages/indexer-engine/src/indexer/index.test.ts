import {
  afterEach, describe, expect, it, vi,
} from "vitest";

import {
  FetchedBlock, ProcessContext,
} from "../chain/index.js";
import {
  ConfigurationError,
} from "../errors/index.js";
import {
  SyntheticBlock, SyntheticChain, syntheticChain,
  SyntheticChainOptions, SyntheticClient,
} from "../mocks/synthetic-chain.js";
import {
  EclesiaIndexerConfig,
} from "../types/index.js";
import {
  defaultIndexerConfig, EclesiaIndexer,
} from "./index";

/**
 * Unit tests for the live block path and lifecycle of EclesiaIndexer, on the synthetic chain
 * adapter: no network, every fetch succeeds instantly. The health and metrics servers are
 * disabled.
 */

const makeIndexer = (overrides: Partial<EclesiaIndexerConfig<SyntheticChain>> = {
}, chainOptions: SyntheticChainOptions = {
}) => new EclesiaIndexer<SyntheticChain>({
  chain: syntheticChain(chainOptions),
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

const stubClient = (latestHeight = 100) => new SyntheticClient("synthetic-1", latestHeight);

afterEach(() => {
  vi.useRealTimers();
});

describe("newBlockReceived", () => {
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const live = (indexer: EclesiaIndexer<SyntheticChain>, latest: number) => {
    const client = stubClient(latest);
    indexer.client = client;
    indexer.blockClient = client;
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

    expect(client.fetched).toEqual([101, 102, 103]);
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

    expect(client.fetched).toEqual([]);
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

    expect(client.fetched).toEqual([]);
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
    expect(client.fetched).toEqual([101, 102]);
    expect(indexer["tryToRecover"]).toBe(false);

    await indexer["blockQueue"].dequeue();
    await settle();
    expect(client.fetched).toEqual([101, 102, 103]);
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

  it("requires a chain adapter with the mandatory methods", () => {
    expect(() => new EclesiaIndexer({
      ...defaultIndexerConfig,
      chain: undefined as never,
      rpcUrl: "http://localhost:26657",
      shouldProcessGenesis: async () => false,
    })).toThrow(ConfigurationError);
    expect(() => new EclesiaIndexer({
      ...defaultIndexerConfig,
      chain: {
        name: "broken",
        connect: async () => ({
        }),
      } as never,
      rpcUrl: "http://localhost:26657",
      shouldProcessGenesis: async () => false,
    })).toThrow("missing disconnect()");
  });

  it("switches to polling when the adapter has no block subscription", async () => {
    const indexer = makeIndexer({
      usePolling: false,
    }, {
      subscriptions: false,
    });
    expect(indexer["config"].usePolling).toBe(true);
    const ws = makeIndexer({
      usePolling: false,
    });
    expect(ws["config"].usePolling).toBe(false);
    await indexer.stop();
    await ws.stop();
  });

  it("switches to polling when the adapter cannot subscribe with this client", async () => {
    const indexer = makeIndexer({
      usePolling: false,
    });
    indexer.chain.subscribeNewBlock = () => null;
    indexer["started"] = true;

    await indexer["setupBlockListening"]();

    expect(indexer["config"].usePolling).toBe(true);
    expect(indexer["unsubscribe"]).toBeNull();
    await indexer.stop();
  });
});

describe("setupBlockListening", () => {
  it("connects two clients, reads the height, and attaches the run's listener", async () => {
    const indexer = makeIndexer({
      usePolling: false,
      chainId: "synthetic-1",
      getNextHeight: () => 42,
    }, {
      latestHeight: 250,
    });
    indexer["started"] = true;

    await indexer["setupBlockListening"]();

    expect(indexer.chain.clients.length).toBe(2);
    expect(indexer["latestHeight"]).toBe(250);
    expect(indexer["nextFetchHeight"]).toBe(42);
    expect(indexer.client.listeners.size).toBe(1);
    expect(indexer["unsubscribe"]).not.toBeNull();

    // An announcement through the subscription reaches the engine
    indexer.client.announce(251);
    expect(indexer["latestHeight"]).toBe(251);
    await indexer.stop();
    // stop() detached the listener and closed both clients
    expect(indexer.client.listeners.size).toBe(0);
    expect(indexer.chain.clients.every(c => c.disconnected)).toBe(true);
  });
});

describe("callABCI", () => {
  it("throws on a non-zero ABCI code instead of returning empty bytes", async () => {
    const indexer = makeIndexer();
    const client = stubClient();
    client.abci = async () => ({
      code: 18,
      log: "height 5 is not available, lowest height is 100",
      value: new Uint8Array(),
    });
    indexer.client = client;

    await expect(indexer.callABCI("/cosmos.staking.v1beta1.Query/Validators", new Uint8Array(), 5)).rejects.toThrow("code 18");
    // an answered query is not an outage: no recovery for ad-hoc callers
    expect(indexer["tryToRecover"]).toBe(false);
    await indexer.stop();
  });

  it("requests recovery when the RPC cannot answer at all", async () => {
    const indexer = makeIndexer();
    const client = stubClient();
    client.abci = async () => {
      throw new Error("socket hang up");
    };
    indexer.client = client;

    await expect(indexer.callABCI("/x", new Uint8Array())).rejects.toThrow("RPC not responding");
    expect(indexer["tryToRecover"]).toBe(true);
    await indexer.stop();
  });

  it("uses the block pipeline client for non ad-hoc queries", async () => {
    const indexer = makeIndexer();
    const adHoc = stubClient();
    const pipeline = stubClient();
    pipeline.abci = vi.fn(async () => ({
      code: 0,
      value: new Uint8Array([7]),
    }));
    indexer.client = adHoc;
    indexer.blockClient = pipeline;

    expect(await indexer.callABCI("/x", new Uint8Array(), 3, false)).toEqual(new Uint8Array([7]));
    expect(pipeline.abci).toHaveBeenCalledWith("/x", new Uint8Array(), 3);
    await indexer.stop();
  });

  it("refuses when the chain adapter has no query method", async () => {
    const indexer = makeIndexer();
    indexer.chain.abciQuery = undefined as never;

    await expect(indexer.callABCI("/x", new Uint8Array())).rejects.toThrow(ConfigurationError);
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

describe("processBlock", () => {
  it("hands the block to the adapter with the height and timestamp every event must carry", async () => {
    const onProcess = vi.fn(async (_block: FetchedBlock<SyntheticBlock>, _ctx: ProcessContext) => {});
    const indexer = makeIndexer({
    }, {
      onProcess,
    });
    const fetched = await indexer.chain.fetchBlock(stubClient(), 7, {
      log: indexer.log,
      prometheus: null,
      minimal: true,
    });

    await indexer["processBlock"](fetched);

    expect(indexer.heightToProcess).toBe(7);
    expect(onProcess).toHaveBeenCalledTimes(1);
    const ctx = onProcess.mock.calls[0][1];
    expect(ctx.height).toBe(7);
    expect(ctx.timestamp).toBe(fetched.timestamp);
    expect(ctx.minimal).toBe(true);
    expect(ctx.emit).toBe(indexer.asyncEmit);
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

  it("ignores the completion of a previous run's subscription while restarting", async () => {
    const indexer = makeIndexer({
      usePolling: false,
    });
    indexer["started"] = true;
    indexer["runGeneration"] = 1;
    const previous = indexer["makeBlockListener"](1);

    // A restart has begun: the new run bumps the generation, then disconnects the old client,
    // which completes the old subscription
    indexer["runGeneration"] = 2;
    previous.complete();
    expect(indexer["tryToRecover"]).toBe(false);

    // The current run's own subscription closing is still a real recovery
    const current = indexer["makeBlockListener"](2);
    current.complete();
    expect(indexer["tryToRecover"]).toBe(true);
    await indexer.stop();
  });

  it("detaches the block listener before closing the previous connection", async () => {
    const indexer = makeIndexer({
      usePolling: false,
    });
    const order: string[] = [];
    const oldClient = stubClient();
    indexer["started"] = true;
    indexer["runGeneration"] = 3;
    indexer["blockListener"] = indexer["makeBlockListener"](3);
    indexer["unsubscribe"] = indexer.chain.subscribeNewBlock!(oldClient, indexer["blockListener"]);
    const unsubscribe = indexer["unsubscribe"]!;
    indexer["unsubscribe"] = () => {
      order.push("unsubscribe");
      unsubscribe();
    };
    const disconnect = indexer.chain.disconnect.bind(indexer.chain);
    indexer.chain.disconnect = (client: SyntheticClient) => {
      order.push("disconnect");
      // A closing socket completes every subscription still attached
      disconnect(client);
    };
    indexer.client = oldClient;
    indexer.blockClient = oldClient;

    expect(await indexer.connect()).toBe(true);

    expect(order.slice(0, 2)).toEqual(["unsubscribe", "disconnect"]);
    expect(indexer["tryToRecover"]).toBe(false);
    expect(indexer.client).not.toBe(oldClient);
    await indexer.stop();
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

  it("fails block listening setup when the node serves another chain", async () => {
    const indexer = makeIndexer({
      chainId: "atomone-1",
    }, {
      network: "cosmoshub-4",
    });
    indexer["started"] = true;

    await expect(indexer["setupBlockListening"]()).rejects.toThrow("chainId is configured as atomone-1");
    expect(indexer["healthCheck"].status).toBe("FAILED");
    await indexer.stop();
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
    const status = vi.fn(async () => ({
      network: "synthetic-1",
      latestHeight: 100,
    }));
    client.statusOverride = status;
    indexer.client = client;
    indexer["started"] = true;
    indexer["latestHeight"] = 100;

    indexer["startPolling"]();
    await settle();
    indexer["startPolling"]();
    await settle();

    expect(status).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);

    await indexer.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(client.disconnected).toBe(true);
  });

  it("clears the inactivity timer armed by a received block", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
    });
    const indexer = makeIndexer();
    indexer.client = stubClient();
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
    indexer.client = stubClient(100);
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
    indexer.client = stubClient(107);
    indexer["started"] = true;
    indexer["latestHeight"] = 100;

    await indexer["checkLiveness"]();

    expect(indexer["tryToRecover"]).toBe(true);
    await indexer.stop();
  });

  it("requests recovery when the RPC cannot be reached", async () => {
    const indexer = makeIndexer();
    const client = stubClient();
    client.statusOverride = async () => {
      throw new Error("ECONNREFUSED");
    };
    indexer.client = client;
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

describe("end to end on the synthetic chain", () => {
  it("processes every block up to endHeight inside a transaction each and stops", async () => {
    const processed: number[] = [];
    const tx: string[] = [];
    const indexer = makeIndexer({
      endHeight: 12,
      batchSize: 4,
      beginTransaction: async () => {
        tx.push("begin");
      },
      endTransaction: async (ok) => {
        tx.push(ok ? "commit" : "rollback");
      },
    }, {
      latestHeight: 12,
      onProcess: async (block) => {
        processed.push(block.height);
      },
    });

    await indexer.start();
    await indexer.whenStopped();

    expect(processed).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(tx.filter(t => t === "begin").length).toBe(12);
    expect(tx.filter(t => t === "commit").length).toBe(12);
    expect(tx).not.toContain("rollback");
    expect(indexer["healthCheck"].status).toBe("OK");
  });

  it("rolls back and gives up on a block that fails deterministically", async () => {
    const tx: string[] = [];
    // Like PgIndexer: resume from the last committed height after a restart
    let next = 1;
    const indexer = makeIndexer({
      endHeight: 3,
      maxFailuresPerBlock: 2,
      getNextHeight: () => next,
      beginTransaction: async () => {
        tx.push("begin");
      },
      endTransaction: async (ok) => {
        tx.push(ok ? "commit" : "rollback");
      },
    }, {
      latestHeight: 3,
      onProcess: async (block) => {
        if (block.height === 2) {
          throw new Error("bad block");
        }
        next = block.height + 1;
      },
    });
    const fatal = new Promise<{
      height?: number
    }>((resolve) => {
      indexer.on("fatal-error", event => resolve(event));
    });

    // First run: block 2 fails once, a restart is scheduled with backoff
    await indexer.start();
    expect(indexer["retryTimer"]).not.toBeNull();
    clearTimeout(indexer["retryTimer"]!);
    indexer["retryTimer"] = null;

    // Restart by hand instead of waiting for the backoff: the same block fails again
    await indexer.start();
    const event = await fatal;

    expect(event.height).toBe(2);
    expect(tx).toEqual(["begin", "commit", "begin", "rollback", "begin", "rollback"]);
    expect(indexer["started"]).toBe(false);
    await indexer.stop();
  });
});
