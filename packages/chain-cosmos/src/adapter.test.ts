import {
  CometClient,
} from "@cosmjs/tendermint-rpc";
import {
  BlockListener,
} from "@eclesia/indexer-engine";
import {
  QueryValidatorsRequest, QueryValidatorsResponse,
} from "cosmjs-types/cosmos/staking/v1beta1/query.js";
import {
  describe, expect, it, vi,
} from "vitest";
import * as winston from "winston";

import {
  cosmos,
} from "./adapter.js";
import {
  MockRpcClient,
} from "./mocks/rpc-client.js";

/**
 * Unit tests for the Cosmos adapter against the in-memory mock node: what it fetches per mode,
 * the order of the events it emits, and how it maps the cosmjs client onto the contract.
 */

const log = winston.createLogger({
  level: "error",
  transports: [new winston.transports.Console()],
});

const mockNode = (cometVersion: "0.37" | "0.38" = "0.37") => new MockRpcClient({
  chainId: "mock-1",
  txPerBlock: 2,
  startHeight: 1,
  endHeight: 10,
  cometVersion,
  validatorCount: 3,
}) as unknown as CometClient;

/** Collects every event emitted through the process context, in order */
const recorder = () => {
  const events: Array<{
    type: string
    value: unknown
  }> = [];
  const emit = async (type: string, event: {
    value: unknown
  }) => {
    events.push({
      type,
      value: event.value,
    });
  };
  return {
    events,
    emit: emit as never,
  };
};

describe("status and connection", () => {
  it("maps the node status onto network and latest height", async () => {
    const adapter = cosmos();
    expect(await adapter.status(mockNode())).toEqual({
      network: "mock-1",
      latestHeight: 10,
    });
  });

  it("uses the custom connect factory when one is given", async () => {
    const client = mockNode();
    const connect = vi.fn(async () => client);
    const adapter = cosmos({
      connect,
    });
    expect(await adapter.connect("http://example:26657")).toBe(client);
    expect(connect).toHaveBeenCalledWith("http://example:26657");
  });

  it("reports null when the client cannot subscribe, and detaches on unsubscribe", () => {
    const adapter = cosmos();
    const http = {
      subscribeNewBlock: () => {
        throw new Error("This RPC client type cannot subscribe to events");
      },
    } as unknown as CometClient;
    const listener: BlockListener = {
      next: vi.fn(),
      error: vi.fn(),
      complete: vi.fn(),
    };
    expect(adapter.subscribeNewBlock(http, listener)).toBeNull();

    const attached = new Set<{
      next: (event: {
        header: {
          height: number
        }
      }) => void
    }>();
    const ws = {
      subscribeNewBlock: () => ({
        addListener: (l: never) => attached.add(l),
        removeListener: (l: never) => attached.delete(l),
      }),
    } as unknown as CometClient;
    const unsubscribe = adapter.subscribeNewBlock(ws, listener);
    expect(attached.size).toBe(1);
    [...attached][0].next({
      header: {
        height: 77,
      },
    });
    expect(listener.next).toHaveBeenCalledWith(77);
    unsubscribe!();
    expect(attached.size).toBe(0);
  });
});

describe("fetchBlock", () => {
  it("fetches block and results only in minimal mode", async () => {
    const adapter = cosmos();
    const fetched = await adapter.fetchBlock(mockNode(), 5, {
      log,
      prometheus: null,
      minimal: true,
    });
    expect(fetched.height).toBe(5);
    expect(fetched.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(fetched.data.block.block.txs.length).toBe(2);
    expect(fetched.data.blockResults.results.length).toBe(2);
    expect(fetched.data.validators).toBeUndefined();
  });

  it("adds the complete validator set in full mode", async () => {
    const adapter = cosmos();
    const fetched = await adapter.fetchBlock(mockNode(), 5, {
      log,
      prometheus: null,
      minimal: false,
    });
    expect(fetched.data.validators?.length).toBe(3);
  });

  it("follows pagination when fetching the validator set", async () => {
    const adapter = cosmos();
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
        log: "",
        value: key.length === 0 ? page(["v1", "v2"], new Uint8Array([1])) : page(["v3"]),
      };
    });
    const client = {
      abciQuery,
    } as unknown as CometClient;

    const merged = await adapter.fetchValidatorSet(client, 42, {
      prometheus: null,
    });

    expect(merged.map(v => v.operatorAddress)).toEqual(["v1", "v2", "v3"]);
    expect(abciQuery).toHaveBeenCalledTimes(2);
  });

  it("fails the fetch when the validator query answers with a code", async () => {
    const adapter = cosmos();
    const client = {
      abciQuery: async () => ({
        code: 18,
        log: "pruned",
        value: new Uint8Array(),
      }),
    } as unknown as CometClient;
    await expect(adapter.fetchValidatorSet(client, 42, {
      prometheus: null,
    })).rejects.toThrow("code 18");
  });
});

describe("processBlock", () => {
  const processed = async (cometVersion: "0.37" | "0.38") => {
    const adapter = cosmos();
    const fetched = await adapter.fetchBlock(mockNode(cometVersion), 3, {
      log,
      prometheus: null,
      minimal: false,
    });
    const rec = recorder();
    await adapter.processBlock(fetched, {
      emit: rec.emit,
      log,
      prometheus: null,
      height: fetched.height,
      timestamp: fetched.timestamp,
      minimal: false,
    });
    return rec.events;
  };

  it.each(["0.37", "0.38"] as const)("emits block, begin_block, tx_events, one event per message, end_block in order (CometBFT %s)", async (cometVersion) => {
    const events = await processed(cometVersion);
    expect(events.map(e => e.type)).toEqual(["block", "begin_block", "tx_events", "tx_memo", "/cosmos.bank.v1beta1.MsgSend", "tx_memo", "/cosmos.bank.v1beta1.MsgSend", "end_block"]);
  });

  it.each(["0.37", "0.38"] as const)("splits begin and end block events and attributes tx events per message (CometBFT %s)", async (cometVersion) => {
    const events = await processed(cometVersion);
    const begin = events[1].value as {
      events: unknown[]
      validators: unknown[]
    };
    expect(begin.events.length).toBe(1);
    expect(begin.validators.length).toBe(3);
    expect((events[7].value as unknown[]).length).toBe(1);
    const msg = events[4].value as {
      tx: Uint8Array
      events: Array<{
        type: string
      }>
    };
    expect(msg.tx).toBeInstanceOf(Uint8Array);
    expect(msg.events.map(e => e.type)).toEqual(["message", "coin_spent", "coin_received"]);
  });
});

describe("genesis", () => {
  it("emits one gentx event per genesis transaction message", async () => {
    const adapter = cosmos();
    const rec = recorder();
    const streamArray = vi.fn(async (path: string, processor: (chunk: unknown[]) => Promise<void>) => {
      expect(path).toBe("app_state.genutil.gen_txs");
      await processor([
        {
          body: {
            messages: [
              {
                "@type": "/cosmos.staking.v1beta1.MsgCreateValidator",
                value: "a",
              },
              {
                "@type": "/cosmos.bank.v1beta1.MsgSend",
                value: "b",
              },
            ],
          },
        },
      ]);
      return true;
    });
    await adapter.genesis({
      emit: rec.emit,
      log,
      streamArray,
      streamValue: async () => true,
      handled: new Map(),
    });
    expect(rec.events.map(e => e.type)).toEqual(["gentx/cosmos.staking.v1beta1.MsgCreateValidator", "gentx/cosmos.bank.v1beta1.MsgSend"]);
  });
});
