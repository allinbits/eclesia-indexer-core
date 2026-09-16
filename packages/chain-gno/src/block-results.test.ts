import {
  describe, expect, it,
} from "vitest";

import {
  decodeBlockResults, decodeRawEvent,
} from "./block-results.js";

/** Block 786 of gnoland-1, as the node returned it: a bank transfer with no realm fields */
const mainnet786 = {
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
              from: "g1qv3dqyw46fut94z9t90jka58saw2e7l99nzqtr",
              to: "g1y7h659patawdy99mlufj9lp3t9cwpt8fq852zq",
              coins: "1000000ugnot",
            },
          ],
          Log: "msg:0,success:true,log:,events:[]",
          Info: "",
        },
        GasWanted: "2000000",
        GasUsed: "1237175",
      },
    ],
    begin_block: {
      ResponseBase: {
        Error: null,
        Data: null,
        Events: null,
        Log: "",
        Info: "",
      },
    },
    end_block: {
      ResponseBase: {
        Error: null,
        Data: null,
        Events: null,
        Log: "",
        Info: "",
      },
      ValidatorUpdates: null,
      ConsensusParams: null,
      Events: null,
    },
  },
};

describe("decodeBlockResults", () => {
  it("decodes a mainnet block with a bank transfer event that has no realm fields", () => {
    const decoded = decodeBlockResults(mainnet786);
    expect(decoded.height).toBe(786);
    expect(decoded.results.deliverTx.length).toBe(1);
    const tx = decoded.results.deliverTx[0];
    expect(tx.gasWanted).toBe(2000000n);
    expect(tx.gasUsed).toBe(1237175n);
    expect(tx.responseBase.error).toBeNull();
    expect(tx.responseBase.log).toContain("success:true");
    expect(tx.responseBase.events).toEqual([
      {
        "@type": "/bank.TransferEvent",
        type: "",
        pkg_path: "",
        attrs: [],
        from: "g1qv3dqyw46fut94z9t90jka58saw2e7l99nzqtr",
        to: "g1y7h659patawdy99mlufj9lp3t9cwpt8fq852zq",
        coins: "1000000ugnot",
      },
    ]);
    expect(decoded.results.beginBlock.responseBase.events).toEqual([]);
    expect(decoded.results.endBlock.validatorUpdates).toBeNull();
  });

  it("handles empty blocks, failed transactions and realm events", () => {
    const decoded = decodeBlockResults({
      height: "12",
      results: {
        deliver_tx: [
          {
            ResponseBase: {
              Error: {
                "@type": "/std.InsufficientCoinsError",
                value: "insufficient coins",
              },
              Data: "aGk=",
              Events: [
                {
                  "@type": "/tm.Event",
                  type: "Greeted",
                  pkg_path: "gno.land/r/eclesia/hello",
                  attrs: [
                    {
                      key: "name",
                      value: "world",
                    },
                    {
                      key: "empty",
                      value: null,
                    },
                  ],
                },
                {
                  "@type": "/tm.StorageDepositEvent",
                  bytes_delta: 10,
                  fee_delta: {
                    denom: "ugnot",
                    amount: 1000,
                  },
                  pkg_path: "gno.land/r/eclesia/hello",
                },
              ],
              Log: "insufficient coins",
              Info: "",
            },
            GasWanted: null,
            GasUsed: null,
          },
        ],
        begin_block: null,
        end_block: null,
      },
    });
    const tx = decoded.results.deliverTx[0];
    expect(tx.responseBase.error).toEqual({
      "@type": "/std.InsufficientCoinsError",
      value: "insufficient coins",
    });
    expect(Buffer.from(tx.responseBase.data).toString()).toBe("hi");
    expect(tx.gasWanted).toBe(0n);
    expect(tx.responseBase.events[0].attrs).toEqual([
      {
        key: "name",
        value: "world",
      },
      {
        key: "empty",
        value: "",
      },
    ]);
    expect(tx.responseBase.events[1]).toMatchObject({
      "@type": "/tm.StorageDepositEvent",
      type: "",
      pkg_path: "gno.land/r/eclesia/hello",
      bytes_delta: 10,
    });
    expect(decodeBlockResults({
      height: "1",
      results: {
        deliver_tx: null,
        begin_block: null,
        end_block: null,
      },
    }).results.deliverTx).toEqual([]);
  });

  it("keeps unknown event fields", () => {
    expect(decodeRawEvent({
      "@type": "/x.Custom",
      anything: [1, 2],
    })).toEqual({
      "@type": "/x.Custom",
      type: "",
      pkg_path: "",
      attrs: [],
      anything: [1, 2],
    });
  });
});
