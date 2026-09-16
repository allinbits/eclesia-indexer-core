import {
  Mocks,
} from "@eclesia/chain-gno";
import {
  describe, expect, it, vi,
} from "vitest";

import {
  BankModule,
} from "../bank/index.js";
import {
  harness, install,
} from "./harness.js";

const abciAnswer = (balances: Record<string, string>) => vi.fn(async (path: string, _data: Uint8Array, _height?: number) => {
  const address = path.replace("bank/balances/", "");
  const coins = balances[address];
  return coins === undefined ? new Uint8Array() : new Uint8Array(Buffer.from(JSON.stringify(coins)));
});

describe("BankModule", () => {
  it("records transfer events and touches their parties and every signer", async () => {
    const h = harness();
    const callABCI = abciAnswer({
      [Mocks.syntheticAddress(1)]: "990ugnot",
      [Mocks.syntheticAddress(2)]: "10ugnot",
    });
    (h.pgIndexer.indexer as unknown as {
      callABCI: unknown
    }).callABCI = callABCI;
    install(h, new BankModule({
      trackAddresses: ["g1collector"],
    }));

    await h.processBlock(4);

    const [transfer] = h.calls("add-bank-transfers");
    expect(transfer.slice(0, 4)).toEqual([4, "tx", expect.stringMatching(/^[0-9A-F]{64}$/), 0]);
    expect(transfer.slice(5)).toEqual([[0], [Mocks.syntheticAddress(1)], [Mocks.syntheticAddress(2)], ["10ugnot"]]);

    // Every signer of the block, both transfer parties and the collector were read at the block's height
    const queried = callABCI.mock.calls.map(c => (c[0] as string).replace("bank/balances/", "")).sort();
    expect(queried).toEqual([Mocks.syntheticAddress(1), Mocks.syntheticAddress(2), Mocks.syntheticAddress(3), Mocks.syntheticAddress(4), "g1collector"].sort());
    expect(callABCI.mock.calls.every(c => c[2] === 4)).toBe(true);

    const upserts = h.calls("upsert-balance");
    expect(upserts).toContainEqual([Mocks.syntheticAddress(1), "ugnot", "990", 4]);
    expect(upserts).toContainEqual([Mocks.syntheticAddress(2), "ugnot", "10", 4]);
    // An unknown account yields no coins and no rows
    expect(upserts.find(u => u[0] === "g1collector")).toBeUndefined();
    expect(h.calls("add-balance-history").length).toBe(upserts.length);
  });

  it("zeroes denominations an address no longer holds", async () => {
    const h = harness();
    (h.pgIndexer.indexer as unknown as {
      callABCI: unknown
    }).callABCI = abciAnswer({
      [Mocks.syntheticAddress(1)]: "5ugnot",
    });
    h.query.mockImplementation(async (sql: unknown) => {
      const name = (sql as {
        name?: string
      }).name;
      if (name === "balance-denoms") {
        return {
          rows: [
            {
              denom: "ugnot",
            },
            {
              denom: "atom",
            },
          ],
          rowCount: 2,
        };
      }
      return {
        rows: [],
        rowCount: 1,
      };
    });
    install(h, new BankModule({
      queryBalances: true,
    }));

    await h.dispatch("block", {
      value: {
        block: {
          block: {
            txs: [new Uint8Array(1)],
          },
        },
      },
      height: 9,
    });
    await h.dispatch("tx", {
      value: {
        hash: "AA",
        index: 0,
        signers: [Mocks.syntheticAddress(1)],
        events: [],
      },
      height: 9,
      timestamp: "2026-09-12T17:00:00.000Z",
    });
    await h.dispatch("end_block", {
      value: [],
      height: 9,
      timestamp: "2026-09-12T17:00:00.000Z",
    });

    expect(h.calls("upsert-balance").sort()).toEqual([[Mocks.syntheticAddress(1), "atom", "0", 9], [Mocks.syntheticAddress(1), "ugnot", "5", 9]]);
  });

  it("imports genesis balances in bulk and can run without balance queries", async () => {
    const h = harness();
    install(h, new BankModule({
      queryBalances: false,
    }));

    await h.dispatch("genesis/array/app_state.balances", {
      value: [
        "g1a=100ugnot,5atom;vesting=100ugnot,0,1",
        {
          address: "g1b",
          amount: "7ugnot",
        },
      ],
    });
    expect(h.calls("add-genesis-balances")).toEqual([[["g1a", "g1a", "g1b"], ["ugnot", "atom", "ugnot"], ["100", "5", "7"]]]);

    await h.processBlock(2);
    expect(h.calls("add-bank-transfers").length).toBe(1);
    expect(h.calls("upsert-balance").length).toBe(0);
  });
});
