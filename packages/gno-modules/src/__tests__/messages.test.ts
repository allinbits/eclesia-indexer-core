import {
  Mocks,
} from "@eclesia/chain-gno";
import {
  describe, expect, it,
} from "vitest";

import {
  MessagesModule,
} from "../messages/index.js";
import {
  harness, install,
} from "./harness.js";

describe("MessagesModule", () => {
  it("writes one row per successful message into its table", async () => {
    const h = harness();
    install(h, new MessagesModule());

    await h.processBlock(4);

    const [send] = h.calls("add-bank-send");
    expect(send[0]).toBe(4);
    expect(send[1]).toMatch(/^[0-9A-F]{64}$/);
    expect(send[2]).toBe(0);
    expect(send.slice(3, 6)).toEqual([Mocks.syntheticAddress(1), Mocks.syntheticAddress(2), "10ugnot"]);

    const [call] = h.calls("add-vm-call");
    expect(call.slice(3)).toEqual([Mocks.syntheticAddress(1), "", "", Mocks.MOCK_REALM, "Increment", JSON.stringify(["4"]), expect.any(String)]);

    const [addpkg] = h.calls("add-vm-addpkg");
    expect(addpkg.slice(3, 9)).toEqual([Mocks.syntheticAddress(3), "counter", Mocks.MOCK_REALM + "_4", "", "1000000ugnot", 1]);

    const [run] = h.calls("add-vm-run");
    expect(run[3]).toBe(Mocks.syntheticAddress(4));
    expect(run[6]).toBe("main");
    expect(JSON.parse(run[7] as string)[0].body).toContain("package main");
  });

  it("skips the messages of failed transactions", async () => {
    const h = harness();
    install(h, new MessagesModule());

    await h.processBlock(4, {
      node: {
        failEvery: 4,
      },
    });

    expect(h.calls("add-vm-run").length).toBe(0);
    expect(h.calls("add-bank-send").length).toBe(1);
  });

  it("stores the events of each transaction in one statement with their realm", async () => {
    const h = harness();
    install(h, new MessagesModule());

    await h.processBlock(6);

    const batches = h.calls("add-gno-events");
    // Only the call and the deployment emit events in the mock
    expect(batches.length).toBe(2);
    const [height, phase, txHash, txIndex, , aminoTypes, types, pkgPaths, attrs] = batches[0];
    expect(height).toBe(6);
    expect(phase).toBe("tx");
    expect(txHash).toMatch(/^[0-9A-F]{64}$/);
    expect(txIndex).toBe(1);
    expect(aminoTypes).toEqual(["/tm.Event"]);
    expect(types).toEqual(["Incremented"]);
    expect(pkgPaths).toEqual([Mocks.MOCK_REALM]);
    expect(JSON.parse((attrs as string[])[0])).toEqual([
      {
        key: "count",
        value: "6",
      },
    ]);
    expect(batches[1][5]).toEqual(["/tm.StorageDepositEvent"]);
    expect(JSON.parse((batches[1][9] as string[])[0]).bytes_delta).toBe(1024);
  });

  it("can leave events out", async () => {
    const h = harness();
    install(h, new MessagesModule({
      storeEvents: false,
    }));

    await h.processBlock(6);

    expect(h.calls("add-gno-events").length).toBe(0);
    expect(h.calls("add-vm-call").length).toBe(1);
  });
});
