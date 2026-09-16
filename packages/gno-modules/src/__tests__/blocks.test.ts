import {
  Mocks,
} from "@eclesia/chain-gno";
import {
  describe, expect, it,
} from "vitest";

import {
  FullBlocksModule, MinimalBlocksModule,
} from "../blocks/index.js";
import {
  harness, install,
} from "./harness.js";

describe("FullBlocksModule", () => {
  it("stores the block with its hash, gas, proposer and signatures", async () => {
    const h = harness();
    install(h, new FullBlocksModule());

    await h.processBlock(3);

    const [block] = h.calls("add-block");
    expect(block[0]).toBe(3);
    expect(block[1]).toMatch(/^[0-9A-F]{64}$/);
    expect(block[2]).toBe(4);
    expect(block[3]).toBe(String(150000 * 4));
    expect(block[4]).toMatch(/^g1/);
    expect(block[5]).toBeInstanceOf(Date);
    const signedBy = JSON.parse(block[6] as string) as Array<{
      validator: string
      round: number
    }>;
    expect(signedBy.length).toBe(3);
    expect(signedBy[0].validator).toMatch(/^g1/);
  });

  it("stores each transaction with decoded messages, fee, result and events", async () => {
    const h = harness();
    install(h, new FullBlocksModule());

    await h.processBlock(5, {
      node: {
        failEvery: 4,
      },
    });

    const txs = h.calls("add-tx");
    expect(txs.length).toBe(4);
    expect(txs.map(t => t[2])).toEqual([0, 1, 2, 3]);
    expect(txs.map(t => t[3])).toEqual([true, true, true, false]);
    expect(txs.every(t => /^[0-9A-F]{64}$/.test(t[0] as string))).toBe(true);

    const send = JSON.parse(txs[0][4] as string);
    expect(send).toEqual([
      {
        "@type": "/bank.MsgSend",
        fromAddress: Mocks.syntheticAddress(1),
        toAddress: Mocks.syntheticAddress(2),
        amount: "10ugnot",
      },
    ]);
    expect(JSON.parse(txs[0][7] as string)).toEqual({
      gas_wanted: "200000",
      gas_fee: "1000000ugnot",
    });
    expect(txs[0][8]).toBe("200000");
    expect(txs[0][9]).toBe("150000");
    expect(txs[0][10]).toBeNull();

    // Package sources are summarised unless asked for
    const addpkg = JSON.parse(txs[2][4] as string)[0];
    expect(addpkg["@type"]).toBe("/vm.m_addpkg");
    expect(addpkg.package.files).toEqual([
      {
        name: "counter.gno",
        size: expect.any(Number),
      },
    ]);
    expect(JSON.parse(txs[2][12] as string)[0]["@type"]).toBe("/tm.storageDepositEvent");

    const failed = txs[3];
    expect(JSON.parse(failed[10] as string)).toEqual({
      "@type": "/std.InsufficientCoinsError",
      value: "insufficient coins",
    });
    expect(failed[11]).toBe("insufficient coins");
  });

  it("keeps package sources in transactions when includeFileBodies is set", async () => {
    const h = harness();
    install(h, new FullBlocksModule({
      includeFileBodies: true,
    }));

    await h.processBlock(2);

    const addpkg = JSON.parse(h.calls("add-tx")[2][4] as string)[0];
    expect(addpkg.package.files[0].body).toContain("package counter");
  });

  it("recomputes block-time averages on the medium periodic tick", async () => {
    const h = harness();
    install(h, new FullBlocksModule());
    h.query.mockImplementation(async (sql: unknown) => {
      if (typeof sql === "string" && sql.startsWith("SELECT height, timestamp FROM blocks")) {
        return {
          rows: [
            {
              height: 40,
              timestamp: "2023-11-14T22:14:40.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      return {
        rows: [],
        rowCount: 1,
      };
    });

    await h.dispatch("periodic/medium", {
      value: null,
      height: 100,
      timestamp: "2023-11-14T22:15:40.000Z",
    });

    const updates = (h.query.mock.calls as unknown[][]).filter(call => typeof call[0] === "string" && (call[0] as string).startsWith("INSERT INTO average_block_time"));
    expect(updates.length).toBe(3);
    // 60 seconds over 60 blocks
    expect(updates[0][1]).toEqual([1, 100]);
  });
});

describe("MinimalBlocksModule", () => {
  it("stores only height and time", async () => {
    const h = harness();
    install(h, new MinimalBlocksModule());

    await h.processBlock(7, {
      minimal: true,
    });

    const [block] = h.calls("add-block-minimal");
    expect(block[0]).toBe(7);
    expect(block[1]).toBeInstanceOf(Date);
    expect(h.calls("add-tx").length).toBe(0);
  });
});
