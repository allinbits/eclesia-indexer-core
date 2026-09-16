import {
  Mocks as EngineMocks,
} from "@eclesia/indexer-engine";
import {
  Tm2Client,
} from "@gnolang/tm2-rpc";
import {
  describe, expect, it, vi,
} from "vitest";
import * as winston from "winston";

import {
  gno,
} from "./adapter.js";
import {
  MSG_ADD_PACKAGE, MSG_CALL, MSG_RUN, MSG_SEND,
} from "./messages.js";
import {
  createMockTm2Client, MOCK_REALM, MockTm2Client, syntheticAddress,
} from "./mocks/tm2-node.js";
import {
  GnoMsgEvent, GnoTx,
} from "./types.js";

/**
 * Unit tests for the gno adapter against the mock Tendermint2 node: what it fetches per mode,
 * the order and content of the events it emits, error mapping, and the engine's adapter
 * contract.
 */

const log = winston.createLogger({
  level: "error",
  transports: [new winston.transports.Console()],
});

const node = (overrides: Partial<ConstructorParameters<typeof MockTm2Client>[0]> = {
}) => new MockTm2Client({
  chainId: "mock-gno-1",
  txPerBlock: 4,
  startHeight: 1,
  endHeight: 10,
  ...overrides,
});

const client = (mock: MockTm2Client) => mock as unknown as Tm2Client;

/** Collects every event emitted through the process context, in order */
const recorder = () => {
  const events: Array<{
    type: string
    value: unknown
    height?: number
    timestamp?: string
  }> = [];
  const emit = async (type: string, event: {
    value: unknown
    height?: number
    timestamp?: string
  }) => {
    events.push({
      type,
      value: event.value,
      height: event.height,
      timestamp: event.timestamp,
    });
  };
  return {
    events,
    emit: emit as never,
  };
};

const processed = async (mock: MockTm2Client, height: number, minimal = false) => {
  const adapter = gno();
  const fetched = await adapter.fetchBlock(client(mock), height, {
    log,
    prometheus: null,
    minimal,
  });
  const rec = recorder();
  await adapter.processBlock(fetched, {
    emit: rec.emit,
    log,
    prometheus: null,
    height: fetched.height,
    timestamp: fetched.timestamp,
    minimal,
  });
  return {
    fetched,
    events: rec.events,
  };
};

describe("status and connection", () => {
  it("maps the node status onto network and latest height", async () => {
    expect(await gno().status(client(node()))).toEqual({
      network: "mock-gno-1",
      latestHeight: 10,
    });
  });

  it("uses the custom connect factory and closes clients through disconnect", async () => {
    const mock = node();
    const connect = vi.fn(async () => client(mock));
    const adapter = gno({
      connect,
    });
    const connected = await adapter.connect("http://example:26657");
    expect(connect).toHaveBeenCalledWith("http://example:26657");
    adapter.disconnect(connected);
    expect(mock.disconnected).toBe(true);
  });

  it("has no block subscription, so the engine polls", () => {
    expect("subscribeNewBlock" in gno()).toBe(false);
  });
});

describe("fetchBlock", () => {
  it("fetches block and results only in minimal mode", async () => {
    const fetched = await gno().fetchBlock(client(node()), 5, {
      log,
      prometheus: null,
      minimal: true,
    });
    expect(fetched.height).toBe(5);
    expect(fetched.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(fetched.data.block.block.txs.length).toBe(4);
    expect(fetched.data.blockResults.results.deliverTx.length).toBe(4);
    expect(fetched.data.validators).toBeUndefined();
  });

  it("adds the validator set in full mode", async () => {
    const fetched = await gno().fetchBlock(client(node({
      validatorCount: 5,
    })), 5, {
      log,
      prometheus: null,
      minimal: false,
    });
    expect(fetched.data.validators?.length).toBe(5);
    expect(fetched.data.validators?.[0].votingPower).toBe(10n);
  });
});

describe("processBlock", () => {
  it("emits block, begin_block, tx and message events per transaction, then end_block", async () => {
    const {
      events,
    } = await processed(node(), 3);
    expect(events.map(e => e.type)).toEqual(["block", "begin_block", "tx", MSG_SEND, "tx", MSG_CALL, "tx", MSG_ADD_PACKAGE, "tx", MSG_RUN, "end_block"]);
  });

  it("stamps every event with the block height and timestamp", async () => {
    const {
      fetched, events,
    } = await processed(node(), 3);
    for (const event of events) {
      expect(event.height).toBe(3);
      expect(event.timestamp).toBe(fetched.timestamp);
    }
  });

  it("decodes each message type and links it to its transaction", async () => {
    const {
      events,
    } = await processed(node(), 7);
    const txs = events.filter(e => e.type === "tx").map(e => e.value as GnoTx);
    expect(txs.map(t => t.index)).toEqual([0, 1, 2, 3]);
    expect(txs.every(t => t.success && t.error === null)).toBe(true);
    expect(txs.every(t => /^[0-9A-F]{64}$/.test(t.hash))).toBe(true);
    expect(txs[0].fee?.gasFee).toBe("1000000ugnot");
    expect(txs[0].memo).toBe("mock tx 7-0");

    const send = events.find(e => e.type === MSG_SEND)!.value as GnoMsgEvent<{
      fromAddress: string
      toAddress: string
      amount: string
    }>;
    expect(send.msg).toEqual({
      fromAddress: syntheticAddress(1),
      toAddress: syntheticAddress(2),
      amount: "10ugnot",
    });
    expect(send.txHash).toBe(txs[0].hash);
    expect(send.msgIndex).toBe(0);
    expect(send.tx).toBe(txs[0]);

    const call = events.find(e => e.type === MSG_CALL)!.value as GnoMsgEvent<{
      pkgPath: string
      func: string
      args: string[]
    }>;
    expect(call.msg.pkgPath).toBe(MOCK_REALM);
    expect(call.msg.func).toBe("Increment");
    expect(call.msg.args).toEqual(["7"]);
    // Events of the whole transaction travel with the message; gno has no per-message index
    expect(call.events.map(e => e.type)).toEqual(["Incremented"]);
    expect(call.events[0].pkg_path).toBe(MOCK_REALM);

    const addpkg = events.find(e => e.type === MSG_ADD_PACKAGE)!.value as GnoMsgEvent<{
      creator: string
      package?: {
        name: string
        path: string
        files: Array<{
          name: string
        }>
      }
      maxDeposit: string
    }>;
    expect(addpkg.msg.package?.path).toBe(MOCK_REALM + "_7");
    expect(addpkg.msg.package?.files.map(f => f.name)).toEqual(["counter.gno"]);
    expect(addpkg.msg.maxDeposit).toBe("1000000ugnot");

    const run = events.find(e => e.type === MSG_RUN)!.value as GnoMsgEvent<{
      caller: string
      package?: {
        name: string
      }
    }>;
    expect(run.msg.caller).toBe(syntheticAddress(4));
    expect(run.msg.package?.name).toBe("main");
  });

  it("emits tx for a failed transaction but none of its messages", async () => {
    const {
      events,
    } = await processed(node({
      failEvery: 2,
    }), 2);
    expect(events.map(e => e.type)).toEqual(["block", "begin_block", "tx", MSG_SEND, "tx", "tx", MSG_ADD_PACKAGE, "tx", "end_block"]);
    const failed = events.filter(e => e.type === "tx").map(e => e.value as GnoTx)[1];
    expect(failed.success).toBe(false);
    expect(failed.error).toEqual({
      "@type": "/std.InsufficientCoinsError",
      value: "insufficient coins",
    });
    expect(failed.log).toBe("insufficient coins");
    expect(failed.messages.length).toBe(1);
  });

  it("skips messages nobody can decode and honours extra decoders", async () => {
    const mock = node({
      txPerBlock: 1,
    });
    const custom = {
      decode: vi.fn(() => ({
        custom: true,
      })),
    };
    const adapter = gno({
      decoders: {
        [MSG_SEND]: custom,
      },
    });
    const fetched = await adapter.fetchBlock(client(mock), 1, {
      log,
      prometheus: null,
      minimal: true,
    });
    const rec = recorder();
    await adapter.processBlock(fetched, {
      emit: rec.emit,
      log,
      prometheus: null,
      height: 1,
      timestamp: fetched.timestamp,
      minimal: true,
    });
    expect(custom.decode).toHaveBeenCalledTimes(1);
    expect((rec.events.find(e => e.type === MSG_SEND)!.value as GnoMsgEvent<unknown>).msg).toEqual({
      custom: true,
    });

    const strict = gno({
      decoders: {
        [MSG_SEND]: undefined as never,
      },
    });
    const rec2 = recorder();
    await strict.processBlock(fetched, {
      emit: rec2.emit,
      log,
      prometheus: null,
      height: 1,
      timestamp: fetched.timestamp,
      minimal: true,
    });
    expect(rec2.events.map(e => e.type)).toEqual(["block", "begin_block", "tx", "end_block"]);
  });

  it("passes the validator set to block and begin_block in full mode", async () => {
    const {
      events,
    } = await processed(node(), 4, false);
    const block = events[0].value as {
      validators: unknown[]
    };
    const begin = events[1].value as {
      validators: unknown[]
      events: unknown[]
    };
    expect(block.validators.length).toBe(3);
    expect(begin.validators.length).toBe(3);
    expect(begin.events).toEqual([]);
    expect(events[events.length - 1].value).toEqual([]);
  });
});

describe("abciQuery", () => {
  it("maps a Tendermint2 error object onto a non-zero code with the error in the log", async () => {
    const adapter = gno();
    const unknown = await adapter.abciQuery(client(node()), "/nope", new Uint8Array());
    expect(unknown.code).toBe(1);
    expect(unknown.log).toBe("/std.UnknownRequestError: unknown request: /nope");

    const balance = await adapter.abciQuery(client(node()), "bank/balances/" + syntheticAddress(1), new Uint8Array(), 5);
    expect(balance.code).toBe(0);
    expect(JSON.parse(Buffer.from(balance.value).toString())).toBe("1000000ugnot");
  });
});

describe("genesis", () => {
  const entries = [
    {
      tx: {
        msg: [
          {
            "@type": MSG_ADD_PACKAGE,
            creator: syntheticAddress(3),
            package: {
              name: "counter",
              path: MOCK_REALM,
              files: [],
            },
            send: "",
            max_deposit: "",
          },
          {
            "@type": MSG_CALL,
            caller: syntheticAddress(1),
            pkg_path: MOCK_REALM,
            func: "Increment",
            args: [],
          },
        ],
        fee: {
          gas_wanted: "1000000",
          gas_fee: "1ugnot",
        },
        signatures: [],
        memo: "",
      },
      metadata: {
        timestamp: "1700000000",
        block_height: "12345",
      },
    },
  ];

  it("emits one gentx event per genesis message with the entry's metadata", async () => {
    const rec = recorder();
    const streamArray = vi.fn(async (path: string, processor: (chunk: unknown[]) => Promise<void>) => {
      expect(path).toBe("app_state.txs");
      await processor(entries);
      return true;
    });
    await gno().genesis({
      emit: rec.emit,
      log,
      streamArray,
      streamValue: async () => true,
      handled: new Map([["gentx/vm.m_addpkg", 1]]),
    });
    expect(rec.events.map(e => e.type)).toEqual(["gentx/vm.m_addpkg", "gentx/vm.m_call"]);
    const first = rec.events[0].value as {
      msgIndex: number
      metadata: {
        block_height: string
      }
      msg: {
        "@type": string
      }
    };
    expect(first.msgIndex).toBe(0);
    expect(first.metadata.block_height).toBe("12345");
    expect(first.msg["@type"]).toBe(MSG_ADD_PACKAGE);
  });

  it("does not stream the file when nothing listens for gentx events", async () => {
    const streamArray = vi.fn(async () => true);
    await gno().genesis({
      emit: recorder().emit,
      log,
      streamArray,
      streamValue: async () => true,
      handled: new Map([["genesis/array/app_state.balances", 1]]),
    });
    expect(streamArray).not.toHaveBeenCalled();
  });
});

describe("adapter contract", () => {
  it.each(EngineMocks.adapterContractCases(gno({
    connect: async () => createMockTm2Client({
      chainId: "contract-gno-1",
      txPerBlock: 2,
      startHeight: 1,
      endHeight: 6,
    }),
  }), {
    url: "http://mock:26657",
    heights: [1, 6],
    network: "contract-gno-1",
  }))("$name", ({
    run,
  }) => run());
});

describe("validator set cache", () => {
  it("asks the node once while the header's validatorsHash is unchanged", async () => {
    const mock = node();
    const validators = vi.spyOn(mock, "validators");
    const adapter = gno();
    for (const height of [1, 2, 3]) {
      const fetched = await adapter.fetchBlock(client(mock), height, {
        log,
        prometheus: null,
        minimal: false,
      });
      expect(fetched.data.validators?.length).toBe(3);
    }
    expect(validators).toHaveBeenCalledTimes(1);

    // A different hash means a different set: fetch again
    const changed = node({
      validatorCount: 5,
    });
    const original = changed.block.bind(changed);
    changed.block = async (height: number) => {
      const block = await original(height);
      return {
        ...block,
        block: {
          ...block.block,
          header: {
            ...block.block.header,
            validatorsHash: new Uint8Array(32).fill(9),
          },
        },
      } as typeof block;
    };
    const fetched = await adapter.fetchBlock(client(changed), 4, {
      log,
      prometheus: null,
      minimal: false,
    });
    expect(fetched.data.validators?.length).toBe(5);
  });
});

describe("own transport", () => {
  /** A node answering over HTTP with block 786 of gnoland-1, whose transfer event has no realm fields */
  const nodeFetch = () => vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Array<{
      id: string
      method: string
    }> | {
      id: string
      method: string
    };
    const requests = Array.isArray(body) ? body : [body];
    const answer = (method: string) => {
      switch (method) {
        case "status":
          return {
            node_info: {
              network: "gnoland-1",
              version: "v1.0.0-rc.0",
              moniker: "n",
              listen_addr: "",
              software: "gno",
              channels: [],
              other: {
              },
              version_set: [],
            },
            sync_info: {
              latest_block_hash: "",
              latest_app_hash: "",
              latest_block_height: "786",
              latest_block_time: "2026-09-12T16:58:00Z",
              catching_up: false,
            },
            validator_info: {
              address: "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5",
              pub_key: {
                "@type": "/tm.PubKeyEd25519",
                value: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
              },
              voting_power: "10",
            },
          };
        case "block_results":
          return {
            height: "786",
            results: {
              deliver_tx: [
                {
                  ResponseBase: {
                    Error: null,
                    Data: "",
                    Events: [
                      {
                        "@type": "/bank.TransferEvent",
                        from: "g1from",
                        to: "g1to",
                        coins: "1000000ugnot",
                      },
                    ],
                    Log: "",
                    Info: "",
                  },
                  GasWanted: "2000000",
                  GasUsed: "1237175",
                },
              ],
              begin_block: null,
              end_block: null,
            },
          };
        default:
          throw new Error("unexpected method " + method);
      }
    };
    const replies = requests.map(r => ({
      jsonrpc: "2.0",
      id: r.id,
      result: answer(r.method),
    }));
    return new Response(JSON.stringify(Array.isArray(body) ? replies : replies[0]), {
      status: 200,
    });
  });

  it("decodes block results itself so bank transfer events do not break the fetch", async () => {
    const fetchFn = nodeFetch();
    vi.stubGlobal("fetch", fetchFn);
    try {
      const adapter = gno({
        requestsPerSecond: 1000,
      });
      const connected = await adapter.connect("https://rpc.example");
      const results = await adapter["blockResults"](connected, 786);
      expect(results.results.deliverTx[0].responseBase.events[0]).toMatchObject({
        "@type": "/bank.TransferEvent",
        pkg_path: "",
        from: "g1from",
        coins: "1000000ugnot",
      });
      // The call went through the batching transport, as a JSON-RPC array
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String((fetchFn.mock.calls[0][1] as RequestInit).body))[0].method).toBe("block_results");
      adapter.disconnect(connected);
    }
    finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("signers and sessions", () => {
  it("lists the signers of every decoded message and who pays the fee", async () => {
    const {
      events,
    } = await processed(node({
      txPerBlock: 9,
    }), 5);
    const txs = events.filter(e => e.type === "tx").map(e => e.value as GnoTx);
    // send, call, addpkg, run, enable, reject, create session, revoke session, revoke all
    expect(txs.map(t => t.feePayer)).toEqual([1, 1, 3, 4, 9, 9, 1, 1, 1].map(i => syntheticAddress(i)));
    expect(txs[0].signers).toEqual([syntheticAddress(1)]);
    expect(events.map(e => e.type).filter(t => t.startsWith("/"))).toEqual([MSG_SEND, MSG_CALL, MSG_ADD_PACKAGE, MSG_RUN, "/vm.m_enable_pkg", "/vm.m_reject_pkg", "/auth.m_create_session", "/auth.m_revoke_session", "/auth.m_revoke_all_sessions"]);
  });

  it("reports the session address only for session-signed transactions", async () => {
    const {
      events,
    } = await processed(node(), 5);
    const txs = events.filter(e => e.type === "tx").map(e => e.value as GnoTx);
    // Only the realm call is signed through the session key in the mock
    expect(txs.map(t => t.sessionAddress)).toEqual([null, syntheticAddress(42), null, null]);
    expect(txs[1].signatures[0].sessionAddr).toBe(syntheticAddress(42));
  });
});
