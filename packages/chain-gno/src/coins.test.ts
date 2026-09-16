import {
  describe, expect, it,
} from "vitest";

import {
  parseCoins, parseTransferEvent, TRANSFER_EVENT,
} from "./coins.js";

describe("parseCoins", () => {
  it("parses single and multiple coins", () => {
    expect(parseCoins("1000000ugnot")).toEqual([
      {
        amount: 1000000n,
        denom: "ugnot",
      },
    ]);
    expect(parseCoins("5ugnot,10atom")).toEqual([
      {
        amount: 5n,
        denom: "ugnot",
      },
      {
        amount: 10n,
        denom: "atom",
      },
    ]);
    expect(parseCoins("")).toEqual([]);
    expect(parseCoins(null)).toEqual([]);
  });

  it("rejects malformed strings", () => {
    expect(() => parseCoins("ugnot")).toThrow("Malformed");
    expect(() => parseCoins("10")).toThrow("Malformed");
  });
});

describe("parseTransferEvent", () => {
  it("reads a mainnet transfer event and ignores other kinds", () => {
    expect(parseTransferEvent({
      "@type": TRANSFER_EVENT,
      type: "",
      pkg_path: "",
      attrs: [],
      from: "g1from",
      to: "g1to",
      coins: "1000000ugnot",
    })).toEqual({
      from: "g1from",
      to: "g1to",
      coins: [
        {
          amount: 1000000n,
          denom: "ugnot",
        },
      ],
      raw: "1000000ugnot",
    });
    expect(parseTransferEvent({
      "@type": "/tm.Event",
      type: "Greeted",
      pkg_path: "gno.land/r/x",
      attrs: [],
    })).toBeNull();
  });
});
